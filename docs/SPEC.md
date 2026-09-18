# Counter specification — the definitions everything else is built on

Phase 1 of [ARCHITECTURE.md](ARCHITECTURE.md) §6. Written 2026-09-09, before any schema,
because each of these decisions is expensive to change once data exists.

There is no code in this phase. Every rule below is a thing the database, the sync
merge, or the streak calculation will assume forever.

---

## 1. A practice day

**A day is the calendar date on the device at the moment of the tap.** Whatever the
phone's clock and timezone said, that is the day the tap belongs to. This is what the
app does today —
[`todayKey()`](../site/src/components/counter-engine.js:119) formats
`getFullYear()-getMonth()-getDate()` — and it does not change.

The alternative was a per-user practice timezone. Rajan chose device time, and under the
per-device component model of ARCHITECTURE §1 that choice is sound: two devices in two
timezones write to two different components and nothing merges badly. The days simply
are the days the user lived through.

Two consequences to accept openly, so neither arrives later as a bug report:

- A user who flies India → US may see one day appear twice or a day appear short. That
  is the calendar they were actually living in.
- Someone who changes their phone's timezone changes which day subsequent taps land on.
  Past days are **never remapped**.

**Never** `toISOString().slice(0, 10)`. That is UTC, and it would roll the day over at
5:30 AM in India — silently moving early-morning japa, which is when most of it happens,
into the previous day.

### Recording the offset (cheap insurance)

Every component write also carries the device's timezone:

```js
zone: Intl.DateTimeFormat().resolvedOptions().timeZone,  // "Asia/Kolkata"
offset: -new Date().getTimezoneOffset(),                 // minutes east of UTC, 330
```

Nothing reads these today. They exist so that if the rule ever has to change, the
information needed to reconstruct days is already in the database rather than lost.
Adding two small columns now costs nothing; recovering a year of days without them is
impossible.

### The clock clamp (this one is not optional)

A device whose clock is wrong writes to a day that never happened, and because
components merge with `GREATEST` that row becomes permanent — a streak and a calendar
wrong for a year, unfixable by the user.

The server therefore rejects any `day`:

- more than **1 day ahead** of the server's own UTC date (one day of slack covers every
  real timezone, since the furthest ahead is UTC+14), or
- more than **5 years behind**.

The client's clock is user input. This is the only reason device-local days are safe.

---

## 2. Reset

`Reset` clears **the visible current session** — `S.count` and the current mala — and
nothing else.

**The historical daily count never decreases.** Nor does the lifetime total. The sync
model in ARCHITECTURE §1 depends on components only ever rising; a reset that lowered a
day's count would be resurrected by `GREATEST` on the next sync anyway, so a decreasing
reset is not merely unwise, it does not work.

Erasing history is a different operation with a different name, a confirmation, and the
tombstone described in ARCHITECTURE M4. It is not what the Reset button does.

---

## 3. A streak day

**A day counts toward the streak when the user completed their own target on it.**

The target is `S.target`, default 108, and the user can change it. Completing it means
the day's total reached the target at least once — in the day record that is
`rec.r >= 1`, the round counter that
[`count()`](../site/src/components/counter-engine.js:431) already increments at every
target boundary.

**When the target is `null`, treat it as 108 for streak purposes.** `S.target` is
nullable — "count freely" — and the existing code guards the round counter with
`if (S.target && …)`, so a user in that mode never increments `rec.r` and would never
earn a streak day at all. That is not a decision anyone made; it is a hole. A free
counter still deserves a streak, and 108 is the tradition it would otherwise be
measured against. Phase 2 records rounds even when the target is null, using 108.

Why not the alternatives:

- *One tap* would make the streak meaningless. A pocket tap would keep it alive, and a
  streak that cannot be broken is not worth showing.
- *A fixed 108* would punish someone whose practice is 21 and flatter someone whose
  practice is 1008. The target is the user's own statement of what a day's practice is;
  the streak should hold them to that and nothing else.

Consequences that follow, and that the UI must respect:

- **Raising the target does not retroactively break old days.** A day is judged against
  the target that was in force when it was practised, so `rec.r` is evaluated as it was
  recorded, never recomputed against today's target.
- **Best streak** is derived from the same day records. It is never stored as its own
  number that could drift out of agreement with the days it summarises.
- The 9 PM reminder asks exactly this question: has today's target been met? If yes, no
  reminder — nobody should be nagged about something they have already done.

---

## 4. What syncs

One source of truth per fact. Anything derivable is derived, so it cannot disagree with
what it was derived from.

| | Synced | Note |
|---|---|---|
| Daily count per name | **yes** | the per-device component; the core of the model |
| Rounds completed per day | **yes** | `rec.r` — the streak depends on it |
| Timer seconds per day | **yes** | `rec.s`, as its own per-device component |
| Current mala progress | **yes** | so a second device resumes mid-mala |
| Custom mantras, favourites | **yes** | user-created content |
| Target, reminder settings | **yes** | preferences that should follow the user |
| Selected name, theme, language | **yes** | small, and their absence is jarring |
| Lifetime total | no | `sum()` of day components |
| Current streak, best streak | no | derived from day records per §3 |
| Stats aggregates | no | derived; never canonical |
| Premium entitlement | server only | a database fact, never a client claim |
| Push tokens | server only | per device, see ARCHITECTURE M8 |

---

## 5. Monotonicity — the invariants the merge depends on

The per-device component model holds only while a component never decreases. Two places
in the existing code break that, and both are fixed in Phase 2.

**Undo.** [`undo()`](../site/src/components/counter-engine.js:440) currently decrements
`S.count`, `S.lifetime` and `rec.c`. After Phase 2 it may only remove taps that the
server has not yet acknowledged:

```
undo is allowed while   day.mine > watermark[day][naam]
undo is refused when    day.mine === watermark[day][naam]
```

where `watermark` is the value the server last confirmed. The button greys out at the
boundary rather than failing silently. The undo stack is cleared on every successful
acknowledgement, because those taps are no longer undoable.

An undo that crosses a mala boundary must also roll back `rec.r`. Today it does not —
`undo()` adjusts `S.count`, `S.lifetime` and `rec.c` and leaves the round counter alone,
so completing a target and then undoing back past it leaves the round credited. That was
harmless while `rec.r` only drove a label. Under §3 it decides whether the streak day is
earned, so from Phase 2 it has to come back down with everything else.

**The outbox follows an undo down (revised 2026-09-10, Phase 10).** The outbox first kept
the higher of the old and new value for each entry. That uploaded taps the user had taken
back before they were ever sent. An entry now holds the component as it is. Lowering it
is safe because undo is only allowed above the watermark: anything lowered was never
confirmed, and the server's `GREATEST` protects whatever was.

**Milestones fire on local taps only.** When another device's component arrives, the
displayed total can cross a mala boundary — potentially several. The burst, the
vibration and the "mala complete" sheet must not fire for that. A sync updates the
number and nothing else. Only a tap in this tab celebrates.

---

## 6. Identity

**`source_id`** identifies a browser installation, not a user and not a device: a random
id generated on first run and stored alongside the counter state. It changes if the user
clears site data, which is correct — that installation's component genuinely restarts
from zero, and its old contribution is already safe in the cloud.

**Migration and import sources.** A one-time upload of pre-existing local history, or a
restored backup file, is written under its own `source_id` derived from that event's id
rather than the current installation's. This is what stops the same history being
counted twice when a backup is restored onto a second device (ARCHITECTURE, audit
findings #2 and #13).

**A cap on sources.** At most **20** distinct `source_id`s per (user, day, name). A
client that minted a new id per request would otherwise grow the table without bound.

### Revised 2026-09-10, before Phase 11 was built: history uploads share one source

The paragraph above planned a migration or import source "derived from that event's id".
Reading the Phase 2 import code showed it cannot work: a restored backup is merged into
the day records, and nothing records which days or taps came from which backup. There is
no per-event history left to derive a source from.

So the one-time upload of pre-existing local history works like this instead:

- It covers only days **before this installation's first successful sync** (`syncFrom`).
  From that day on, the installation's own component carries everything, so no day is
  uploaded twice from one device.
- Every installation uploads its history under one shared, reserved source,
  **`local-history`**, merged with `GREATEST` like any component. A normal installation
  can never use that id.
- A device shows, per day and name, **the larger of** its own local record and the
  `local-history` row, **plus** every other device's component. `sync_others` returns the
  two kinds apart so the client can do that.

- The outbox is not a history upload. It has recorded every day since Phase 2, long
  before an account existed. An installation therefore sends under its own id only
  days on or after `syncFrom` (or today, before the first sync). On the first
  acknowledgement it drops older entries. Otherwise those days would go up twice: once
  as the device, once as `local-history`. Every other device would then count them twice.

Why: the likely case — a backup restored onto a second device, then both devices sign in —
uploads the same history twice, and `GREATEST` keeps it once. The cost is a rare one: two
devices that each chanted the same name on the same day *before either had ever synced*
keep the larger count, not the sum. Never inflating a count was judged the better failure
than a one-time under-count of pre-Premium days that cannot be told apart anyway.

### Added 2026-09-11: whose practice a device holds (Rajan's decision)

Before this, any signed-in device merged whatever it had counted into the account. That
is right for a new buyer and wrong on a shared or old device: counts only rise, so a
family member's chants or an old free counter would be in the account for good. Each
device now records `owner`, the account whose practice it holds
(`src/lib/counter/account-link.ts`), and nothing syncs until that is settled.

| On this device | The account | What happens |
|---|---|---|
| no practice yet | any | the account's practice is pulled and shown |
| a free practice | empty (just bought) | the practice goes up and becomes the account's |
| a free practice | already has one | the account's is shown; the device's is **set aside untouched** in `njc.stash`, and the user is asked once whether to add it |
| another account's practice | any | the device starts empty for this account (the other's is in its own cloud) |
| synced before `owner` existed | this one | adopted as this account's |

"Add to my account" uploads the set-aside practice under **its own old installation id**,
as one more device. Devices are summed, so it adds to the account rather than being
compared with it, and nothing is merged into this device's own record to go up twice.

**Sign out** first sends whatever is unsent. If it cannot, the user is told and may try
again or sign out anyway. Then the account's practice leaves the device and the device
gets back what it had before sign-in — the set-aside practice, or an empty counter.
Device settings (theme, language, target, mode) are never moved. A backup file never
carries `owner`.

### Added 2026-09-12: "Last synced", and Hindi outside the counter

**Last synced** (`src/lib/counter/last-sync.ts`). Sync says nothing while it works, which
is right during a chant and wrong afterwards: a sync that had quietly stopped — an expired
session, a week offline — looked exactly like one that was working. The engine now stamps
`njc.synced` whenever the server answers (an upload or a pull), the account page shows it in
words ("just now", "3 hours ago", a date beyond a month), and leaving the account clears it.
It is per device on purpose: the question is whether THIS device is reaching the account, so
another device's time would answer the wrong question. Nothing about it crosses the API.

**Hindi on Streak and Stats** (`src/lib/counter/page-lang.ts`). The counter has had both
languages since Phase 1; the two pages that read the same practice stayed in English, so
choosing Hindi changed the ring and left them speaking another language. They now follow the
counter's own two saved settings — `lang` and `numerals` (`latin` / `deva`) — for every
string, the month and weekday names, the bar labels and the digits. One flat dictionary, no
i18n library, English as the fallback for any key a future page forgets.

---

## 7. Limits

Every number crossing the API is validated at the boundary, and these are the bounds.

| Field | Rule |
|---|---|
| `day` | `YYYY-MM-DD`, within the clamp of §1 |
| `count` | integer, `0 <= n <= 10_000_000` |
| `s` (time on the mala) | integer **milliseconds**, `0 <= n <= 86_400_000` per day |
| `naam_id` | known id, or a custom id of at most 120 characters |
| custom mantra text | 120 characters, as the import handler already enforces |
| components per request | 200 |
| history entries in an import file | 20_000 (about 54 years) |
| import file | at most 5 MB; parsed as JSON data only, never executed or uploaded |
| import days | real dates from 1900-01-01 to tomorrow; `r` never above `c` |
| import ids and text | ids match `[A-Za-z0-9_.:-]{1,120}` (custom: `c…`); `__proto__`, `constructor`, `prototype` refused; control and direction-override characters stripped |
| import confirmation | the user is told how many chants and days a file adds, and agrees, before anything is merged |
| request body | 256 KB, well under the 64 KiB-per-keepalive budget once split |

Counters are `bigint` in Postgres. The ceiling is unreachable by a human, and the column
type is free.

---

## 8. What Phase 2 builds from this

- `njc:hot` / `njc:cold` storage split, with `source_id` and the watermark in hot state
- the keyed outbox of ARCHITECTURE §4
- undo watermark and milestone-on-local-tap-only, per §5
- ~~`BroadcastChannel` leader election, so two tabs cannot both mutate the counter~~ —
  replaced on 2026-09-11 at Rajan's request: every tab counts into one total. Each save
  stamps `njc.rev`; before any change a tab takes in whatever another tab saved since it
  last looked, and the storage event shows each tap in every open tab
- `storage.persist()`
- import that merges with provenance instead of overwriting, per §6
- the previous state preserved as `njc:legacy_v1`

None of it needs a server, and all of it is testable with vitest.

---

## Still open — a business decision, not a schema one

The Rs 200 lifetime economics (ARCHITECTURE M10): roughly 19 sales a month, forever,
just to cover Supabase Pro plus an SMTP provider, against a sales curve that decays by
nature. Subsidise from ads, raise the price, or bound what lifetime includes. This
does not block Phase 2 — the plan is already versioned as
`plan_id = premium_lifetime_v1` with the price stored on the purchase row, so it can be
answered any time before Ship 3.
