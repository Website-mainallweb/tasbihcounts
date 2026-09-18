# Architecture — final, after external audit

Written 2026-09-09. This supersedes the sync and payment designs in
[REVIEW-BRIEF.md](REVIEW-BRIEF.md); [SECURITY.md](SECURITY.md) stands except where
noted below. An external audit found seven blocker-level problems in the brief. Most of
them are right. One of them is my error and it is the important one.

---

## 1. The error: `GREATEST` is not a multi-device merge

The brief claimed the merge rule `GREATEST(server, incoming)` "lets two devices run at
once without either losing data". That is false, and the counterexample is trivial:

```
cloud = 100

phone  downloads 100, chants 20  -> uploads 120
laptop downloads 100, chants 30  -> uploads 130

GREATEST(100, 120) = 120
GREATEST(120, 130) = 130

actually chanted: 150.   stored: 130.   silently lost: 20.
```

`GREATEST` over a **total** makes retries idempotent — that part was right and is worth
keeping — but it treats two independent contributions as competing versions of the same
number and discards the smaller. For a product whose stated worst failure is losing
someone's count, shipping that would have been the bug that mattered.

### The fix: count per device, sum across devices

Stop storing a total. Store each device's own contribution, and derive the total.

```sql
create table counter_components (
  user_id   uuid  not null references auth.users on delete cascade,
  day       date  not null,          -- canonical practice day, see §3
  naam_id   text  not null,
  source_id text  not null,          -- device install id, or a migration/import id
  count     bigint not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day, naam_id, source_id)
);
```

Each device uploads the **absolute value of its own component**, never a total and never
a delta:

```sql
insert into counter_components (user_id, day, naam_id, source_id, count)
values ($1, $2, $3, $4, $5)
on conflict (user_id, day, naam_id, source_id)
  do update set count = greatest(counter_components.count, excluded.count),
                updated_at = now();
```

The displayed total is `sum(count)` over the row's components. Now all three properties
hold at once — retry-safe, offline-safe, and genuinely multi-device. This is a G-Counter
CRDT, which is the standard answer for exactly this shape of problem.

`GREATEST` did not go away. It moved down one level, from the total to the component,
which is the only level where it is correct.

### What this forces on the client (the audit did not spell this out)

The counter engine currently tracks one number per day: the total. Under components it
has to track two:

```js
day.total      // what the user sees = other devices' components + mine
day.mine       // this device's own contribution, the only thing ever uploaded
```

Two consequences fall out of that, and both are real bugs waiting to happen:

**Milestones must not fire on sync.** When the laptop's 30 arrives, the phone's total
jumps 120 → 150. That crosses a mala boundary. The burst animation, the vibration and
the "mala complete" milestone must fire **only on a local tap**, never on a
sync-induced change. Otherwise the phone celebrates in the user's pocket.

**Undo is now a correctness bug.** `undo()` at
[counter-engine.js:440](../site/src/components/counter-engine.js:440) does
`S.count = prev; S.lifetime -= back; dayRec().c -= back`. It **decrements**. A component
that goes down and then back up will be resurrected to its high-water mark by
`GREATEST`, and the undone tap comes back forever.

Undo therefore has to be constrained: it may only remove taps from the portion of the
current component that has **not yet been acknowledged by the server**. Track a
`flushedAt` watermark per component; undo below it is refused (grey out the button), and
the undo stack is cleared on every successful ack. This is a small change and it must
happen in the same commit as the component model, not after.

The audit missed undo entirely. It is the sharpest edge in the existing code.

---

## 2. Where I disagree with the audit

The audit is strong. Five points need adjusting.

**Finding #12 (timer must use timestamps, not `setInterval`) is already done.**
`tickTime()` at [counter-engine.js:406](../site/src/components/counter-engine.js:406)
computes from `Date.now()` deltas and already refuses to count time outside an active
sitting. No change needed.

**Finding #9 (day rollover on every tap) is half done.** `count()` already re-derives
the day and `dayRec()` keys off `todayKey()` per call, so a tap after midnight lands on
the correct day today. What is genuinely missing is *closing* the previous day —
flushing its component before the new one opens. Narrower than stated, still required.

**Finding #3 (two tabs) is worse than stated.** The audit describes losing one tap to a
read-modify-write race. The real behaviour is worse: each tab holds its own in-memory
`S` and writes the whole object, so the tab that saves last overwrites **the other tab's
entire session**, not one increment. Severity up, not down. `BroadcastChannel` leader
election is the right fix and it is now P1 rather than nice-to-have.

> **Changed 2026-09-11.** The election (one tab counts, others watch behind "Count here")
> was removed at Rajan's request. The same overwrite is now prevented differently: every
> tab counts, every save stamps `njc.rev`, and a tab takes in the latest saved state
> before it changes anything, so no tab ever writes a stale copy. Sync runs from any
> tab; its values are absolute and merged with `GREATEST`, so duplicate sends are harmless.
>
> **Also 2026-09-11 — whose practice.** A device records the account whose practice it
> holds (`owner`) and does not sync until that is settled: a free practice goes up only
> into an empty (just-bought) account; on an account that already has one it is set
> aside in `njc.stash` and offered once; sign out sends what is unsent, then gives the
> device back its own practice. Full table in SPEC §6. Email sign-in links now use the
> implicit flow and land on `/auth/confirm/`, so they work in any browser.
>
> **Also 2026-09-11 — behaviour fixed from the UX walkthrough.** The timer reads the
> clock (end time) instead of counting ticks, keeps the screen awake while it runs, and
> ends with a bell, a lasting notice and the chip released. Auto ends with each mala and
> skips ticks while the page is hidden. A sheet adds one history entry, so Android's Back
> closes it. `public/sw.js` keeps the counter, Streak and Stats pages and hashed static
> assets for offline use (network first for pages; never touches sign-in, account,
> admin or any API; not registered on localhost, and blocked in Playwright). A refused
> storage write is remembered (`Storage.writeFailed`) and the user is told once. The
> built-in names moved to `src/lib/counter/names.ts`, so Stats shows names, not ids.

**Finding #5 (move history to IndexedDB) is over-engineered for now.** Ten years of
history is roughly 165 KB; `JSON.stringify` on that is a couple of milliseconds, not a
crisis. Splitting the *storage key* gets nearly all the benefit for a fraction of the
work:

```
njc:hot   today + current naam + outbox + watermark   ~1 KB, written every tap
njc:cold  historic days                               written on rollover / idle / hide
```

Two synchronous `localStorage` keys, no async migration, no IndexedDB. Revisit if
`njc:cold` passes ~1 MB.

**Finding #17 (verify the Checkout callback signature) is P1, not P0.** Razorpay's
integration guide does require it and it should be built — but the webhook is
authoritative and grants the entitlement. The callback verification exists to fail fast
and to show "payment received, activating…". Nothing is granted from it, so no security
property depends on it.

**Finding #25 (branch protection) needs reframing for a solo repo.** Requiring pull
request review of yourself is theatre. The real gap is that Hostinger builds straight
from `main`, so a bad push deploys. The fix is a GitHub Actions workflow running
`npm ci && npm run check` on every push, and deploying from a `release` branch that only
moves when the check is green. Pre-push hook stays as convenience.

---

## 3. What both of us missed

Ten findings that appear in neither document.

**M1 — `getClaims()` does not help this project yet.** The audit recommends switching
from `getUser()` to `getClaims()` to avoid an Auth round-trip. But this project's JWTs
are `{"alg":"HS256"}` — legacy symmetric signing. Local verification via cached JWKS
requires asymmetric keys. On HS256, `getClaims()` cannot verify offline and the saving
does not materialise. **Keep `getUser()` for now.** Revisit together with the
`anon`/`service_role` → `sb_publishable_`/`sb_secret_` migration, which is the same
migration that introduces asymmetric JWTs.

**M2 — beacon, CSRF and the HTTP verb are one problem, not three.** The audit raises
them separately (#7, #27). They connect:

- `sendBeacon` cannot set headers, so it cannot carry `Authorization: Bearer` — which
  forces cookie auth — which is exactly what makes the sync endpoint CSRF-able.
- `fetch(url, { keepalive: true })` survives page unload *and* can set headers.

So: **use `fetch` with `keepalive`, a bearer token, and POST.** That single choice
resolves #7 (beacon is POST-only), removes the PUT/beacon contradiction, and makes #27
mostly moot because a cross-site page cannot forge a bearer header. Keep `SameSite=Lax`
cookies and an `Origin` check as depth, not as the primary defence. Payloads stay far
under the 64 KiB keepalive budget.

**M3 — the privacy policy becomes false the moment login ships.** `next.config.mjs`
says, in a comment that reflects the live policy, "no backend, no accounts and no
cookies". Adding email login, payments and cloud storage makes that untrue. Under
India's DPDP Act the site will need stated purpose, consent, a named contact, retention
policy and a deletion path. This is a launch blocker, not a nicety, and it is cheap to
do early and expensive to bolt on.

**M4 — account deletion collides with monotonic counters.** "Counts never decrease" and
"the user may erase their data" are in direct conflict. Deletion must be a distinct
operation: delete the auth user, cascade the components, and record a tombstone
`(user_id, deleted_at)` so a late webhook or a queued sync from an old device cannot
resurrect the rows. Without the tombstone, an offline phone syncing a week later
recreates a deleted account's data.

**M5 — paid but never logged in.** Pay-first means a purchase can sit unclaimed
indefinitely: the user paid, the account exists, they never clicked the email. Needs a
defined policy — reminder emails at day 3 and day 14, and a "claim your purchase" flow
reachable from the site with just the payment email. Otherwise this is a refund request
and a support ticket.

**M6 — test and live payments will share one database.** The current keys are
`rzp_test_`. When live keys arrive, test-mode purchase rows must not grant live
entitlement. Add a `mode` column (`test` | `live`) to purchases and entitlements, set it
from which key signed the webhook, and make every entitlement read filter on the current
mode. Cheap now, ugly later.

**M7 — a wrong device clock poisons a day forever.** A phone set to 2027 writes a
component under a future `day`, and `GREATEST` makes it permanent — the streak and the
calendar are wrong for a year. The server must clamp: reject any `day` more than one day
ahead of server time, or more than a few years behind. The client's clock is user input.

**M8 — component count needs a ceiling per (day, naam).** Not the value, the *number* of
`source_id`s. A malicious or buggy client that mints a new install id per request grows
the table without bound. Cap it (say 20 sources per user-day) and reject beyond that.

**M9 — the AdSense script should not load at all for premium.** The brief only hides the
slot. Not loading `pagead2.googlesyndication.com` improves speed, privacy and layout
stability, and is the actual thing premium buyers paid for. Keep the last verified
entitlement cached locally so a Supabase outage does not put ads back in front of a
paying user — that cached flag hides ads and authorises nothing else.

**M10 — the break-even is about 11 sales a month, forever.** The audit correctly says
per-request cost modelling is wrong for Supabase, but stops short of the number. Real
floor once backups are required (Supabase Pro $25 + an SMTP provider ~$20) is roughly
$45/month ≈ ₹3,800. Razorpay takes 2% + GST, so ₹200 nets ₹195.28.

```
₹3,800 / ₹195.28 ≈ 19 sales every month, forever, just to stand still
```

Lifetime plans have a decaying sales curve by nature, while the cost line is flat. That
is the actual business risk — not gateway fees. Three ways out, and one should be chosen
deliberately rather than by default:

1. Accept it: AdSense revenue from free users subsidises the platform. Check that the ad
   revenue actually covers ₹3,800/month before relying on it.
2. Price higher. ₹499 lifetime needs 8 sales/month instead of 19.
3. Bound what "lifetime" includes — e.g. cloud sync guaranteed for N years — stated
   plainly at purchase.

Whatever is chosen, the audit's advice holds: never hardcode ₹200. Store
`plan_id = premium_lifetime_v1` with the price on the purchase row, so v2 can be priced
differently without touching existing buyers.

---

## 4. The locked design

### Local tap path (nothing on the network)

```
tap
 -> derive canonical practice day (§5)
 -> if this tab is not the leader, refuse to count
 -> day.mine += 1 ; day.total += 1 ; lifetime += 1
 -> write njc:hot synchronously   (small object, every tap)
 -> mark outbox entry (day, naam, source) = day.mine
 -> milestone check — local taps only
 -> render
```

### Outbox

Keyed, never a single record — a day boundary or a name switch must not overwrite a
pending entry:

```js
outbox[`${day}|${naamId}`] = { count: day.mine, version: ++v }
```

An entry clears only when the server acknowledges **that version**. If the count moved
while the request was in flight, the entry stays dirty.

### Flush

Triggers: 10 s idle · mala completion · 60 s max staleness ·
`visibilitychange → hidden` (primary; `pagehide` as fallback only — it is unreliable on
mobile).

Transport: `fetch(POST /api/sync, { keepalive: true, headers: { Authorization } })`.

The server returns canonical component values; the client clears only acknowledged
versions and adopts the returned total.

### Payment

The webhook is not one function that does everything. It advances a state machine, and
every retry resumes wherever the last attempt stopped:

```
created -> payment_verified -> captured -> user_created
        -> entitlement_active -> notified
                     |
                     +-> failed_recoverable  (retried)
                     +-> refunded / revoked
```

Tables: `purchases (order_id unique, plan_id, expected_amount, expected_currency, mode,
checkout_email, state)`, `payments (payment_id primary key)`,
`webhook_events (event_id unique)`, `entitlements (user_id, plan_id, status, mode)`.

Webhook order of operations:

1. Verify HMAC-SHA256 over the **raw** body with `timingSafeEqual`
2. Dedupe on `x-razorpay-event-id`
3. Look up **our** `purchases` row by `order_id` — the expected amount comes from that
   row, never from a literal in the handler
4. Require `captured`, and matching amount, currency and mode
5. Persist the payment as a durable fact
6. Reconcile forward until `entitlement_active`

The audit's sharpest payment finding stands and is worth restating: **"row exists →
return 2xx" is not idempotency.** If the user was created but the entitlement insert
failed, that shortcut strands a paying customer with no premium, permanently. Idempotent
means *re-run the transition until the final state exists*, then return 2xx.

---

## 5. Definitions that must exist before any schema

The audit is right that these are the least specified part, and every one of them
changes the database.

**A day** is the calendar date in `profile.practice_timezone` (an IANA name, default
`Asia/Kolkata`, captured at signup). Not `new Date()`, and never
`toISOString().slice(0,10)` — that is UTC and would roll the day over at 5:30 AM in
India. Existing local-date keys are grandfathered as-is and never remapped. Changing the
timezone applies from the next practice day forward.

**Reset** clears the visible current mala or session only. The historical daily count
never decreases. Erasing history is a separate, explicit operation using the deletion
path in M4.

**A streak day** — currently undefined and needed by both the streak page and the 9 PM
reminder. Recommendation: any day with at least one mala completed against the user's
own target. "At least one tap" makes the streak meaningless; "target completed" is what
the user actually means by having practised.

**Sync scope.** Synced: daily counts per name, current mala progress, timer durations,
library preferences, reminder settings. Derived and never synced: lifetime totals,
current streak, best streak, stats aggregates. Server-only: entitlement, push tokens.
One source of truth per fact.

---

## 6. Build order — five ships, twelve phases

Grouped so that each **ship** is independently deployable and leaves the site better
than it found it. Nothing is a big-bang release. Guardrails and everything local can
start immediately; only sync and payment wait on the definitions in §5.

### Ship 1 — Foundation and data safety

Invisible to users, and the highest-value work in the whole plan: it stops the site
losing data it is losing today.

| # | Phase | Done when |
|---|---|---|
| 0 | Guardrails | `npm run check` (typecheck, lint, vitest, `npm audit`, build) passes; GitHub Actions runs it on push; deploy moves to a green `release` branch; secret scanning live; `next >= 16.3.3` floor recorded |
| 1 | Definitions (§5) | Practice day, reset, streak day and sync scope written down and reviewed. No code. |
| 2 | Local correctness | `njc:hot` / `njc:cold` split; keyed outbox; undo watermark; milestones on local taps only; `BroadcastChannel` leader election; `storage.persist()`; import merges with provenance instead of overwriting; `njc:legacy_v1` kept |

Phase 2 alone fixes the import bug that currently wipes newer days, the two-tab
overwrite, and the iOS eviction risk. Worth shipping on its own.

### Ship 2 — The new app, still with no backend

Most of the visible product, at zero backend risk.

| # | Phase | Done when |
|---|---|---|
| 3 | Nav + responsive shell | Header navigation, centred (Counter · Streak · Stats · Library · Settings, the rest under More; a drawer below 768) — a sidebar was built first on a misreading and removed; distinct mobile / tablet / desktop layouts, including landscape phone and tablet; Playwright green at 375 / 768 / 1440 plus the breakpoint edges |
| 4 | Streak page | Current and best streak, week strip, month calendar, header flame — all from local data |
| 5 | Stats page | Naam/Timer toggle, Daily/Monthly/Yearly, chart, per-name filter; chart lazy-loaded so the counter's bundle does not grow |
| 6 | Legal + policy | Terms, Refund/Cancellation, rewritten Privacy Policy covering accounts, payments and deletion (DPDP) |

**Phase 6 is scheduled here on purpose, well before payments.** Razorpay will not issue
live keys without those pages, and KYC runs on its own clock — start it while Ship 2 is
being built, not when Ship 3 is finished.

### Ship 3 — Accounts and money

| # | Phase | Done when |
|---|---|---|
| 7 | Schema + RLS + DAL | Every table has RLS with both `using` and `with check`; the isolation test matrix passes; `requireUser()` exists and every handler calls it |
| 8 | Auth | Signups off, OTP `shouldCreateUser: false`, Google same-email path, custom SMTP; a CI test asserts public signup fails |
| 9 | Payment | Purchase state machine; Checkout signature; webhook raw-body HMAC + event-id dedupe + order binding + captured/amount/currency/mode checks; reconciliation resumes a half-finished purchase |

Gate before Ship 4: a real test purchase in live mode, followed by a real login.

### Ship 4 — Sync and reminders

| # | Phase | Done when |
|---|---|---|
| 10 | Sync | Per-device components; `POST /api/sync` with `fetch` + `keepalive` + bearer; property-based tests for the invariants; a two-device concurrency test proving nothing is lost |
| 11 | Free → premium migration, then FCM | One-time provenance-tagged upload of existing local history; `push_installations` per device; timezone-aware 9 PM scheduler; iOS add-to-home-screen onboarding |

### Ship 5 — Production hardening

| # | Phase | Done when |
|---|---|---|
| 12 | DR + support + launch gate | Supabase Pro; backups configured **and a restore actually performed**; admin support view; accessibility and bundle budgets green; two-device sync verified on real hardware |

Supabase Free pauses inactive projects and has no downloadable backups. For a product
whose promise is "your count is safe", **Pro is a launch requirement, not an upgrade.**
A backup that has never been restored is a theory, not a backup.

### Critical path

Three things run on other people's clocks and should be started early rather than
discovered late: Razorpay KYC (needs Phase 6's pages), custom SMTP provider setup and
domain verification, and the Supabase key migration to `sb_publishable_`/`sb_secret_`
with asymmetric JWTs (which is also what unlocks `getClaims()` — see M1).

---

## 7. Still open — Rajan's call

1. **Streak day rule** — one tap, 108, or the user's own target? (I recommend: own target)
2. **The ₹200 economics** — subsidise from ads, raise the price, or bound the lifetime
   guarantee? Nineteen sales a month, forever, is the number to react to.
3. **Practice timezone** — fixed `Asia/Kolkata` for everyone, or per-user at signup?

---

## Sources

- [Next.js August 2026 Security Release](https://nextjs.org/blog/august-2026-security-release)
- [Next.js July 2026 Security Release](https://nextjs.org/blog/july-2026-security-release)
- [Next.js image optimization AVIF RCE (GHSA-2xp9-vwfh-vxw4)](https://blogs.jsmon.sh/ghsa-2xp9-vwfh-vxw4-next-js-image-optimization-avif-rce-via-libheif-heap-overflow/)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase: service role key and RLS](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z)
- [Razorpay: validate and test webhooks](https://razorpay.com/docs/webhooks/validate-test/?preferred-country=US)
- [MDN: Beacon API](https://developer.mozilla.org/en-US/docs/Web/API/Beacon_API)
- [MDN: Window pagehide event](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event)
- [web.dev: storage for the web](https://web.dev/articles/storage-for-the-web)
