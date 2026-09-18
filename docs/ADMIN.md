# Admin back-office — design

`admin.bhaktinamjap.com`, served by the same Next application as the site. One
admin (Rajan), Google sign-in only, no content management system beyond the name
library.

Written 2026-09-15. Scoped from the MyTasbih admin specification, cut down to what
this product actually has: one lifetime plan, no subscriptions, no leaderboard, no
religious review workflow, no blog.

---

## 1. Shape

One application. The panel is served at a subdomain of the same Next app that
serves the site:

```text
bhaktinamjap.com          the site     src/app/(site)/…
admin.bhaktinamjap.com    the panel    src/app/admin/…
```

**Revised 2026-09-15.** This began as a second Next application in an `admin/`
folder, deployed separately. Rajan asked for one project instead, and one project
it is: a single build, a single deploy, one set of environment variables, and no
HTTP hop between the panel and the code it needs.

### How the subdomain works

`src/proxy.ts` rewrites requests whose host starts with `admin.` onto the
`/admin` routes, and answers `/admin` on the main domain with a 404. A rewrite,
not a redirect: the address bar keeps saying admin.bhaktinamjap.com, and the
session cookie stays on the host it was set for.

`/auth`, `/api` and `/_next` are explicitly **not** rewritten. They mean the same
thing on both hosts — and `/auth/callback/` in particular has to run on the
subdomain, because that is where Google returns the operator. Rewriting it would
have broken sign-in at the last step, with Google reporting success.

None of this is an access check. A proxy can be skipped (docs/SECURITY.md §3), so
every admin page and action calls `requireAdmin()` itself and
`scripts/check-admin-guards.mjs` fails the build on any that does not.

### Why a route group

`app/(site)/` holds the header, footer, promo bar, analytics and the AdSense
loader; `app/admin/` holds none of them. Parentheses, so not one URL changed.

The AdSense loader is why this is a structural split rather than a few lines of
CSS. It does not only fill the slots `AdSlot` renders — it also runs Auto Ads,
which place units of their own anywhere on the page. Setting `pauseAdRequests`
before the loader was tried first and was **not** enough: the loader replaces
`window.adsbygoogle` with its own object and the flag went with it. An ad
appeared on the panel's sign-in page. The only reliable answer is not to load it
there at all.

### Nothing is duplicated

There is no second copy of anything, and no internal API keeping two applications
in step. Re-running a stuck purchase calls `reconcile()` directly — the same
function the checkout and the webhook use — so there is exactly one path to
Premium and it is the one with the money checks in it.

Reads that cross into `auth.users` or `private.*` go through SECURITY DEFINER
functions granted to `service_role` alone
(`supabase/migrations/20260915130000_admin_support.sql`), because PostgREST
exposes neither.

---

## 2. Access

One role. There is one operator.

**Google, and only Google** (Rajan, 2026-09-15). No password form, no one-time
code, no "forgot password" — none of those exist in the panel. That is a smaller
surface than the site's own sign-in, not a larger one: there is no secret here to
guess, to phish, or to reset.

The second factor comes from the Google account itself. Turn on 2-Step
Verification there and the panel has it. This code cannot check or enforce that,
which is worth knowing rather than assuming.

- Identity is the same Supabase project as the site. An admin is an account whose
  confirmed email is in `ADMIN_EMAILS` — the rule `src/lib/admin.ts` already
  used. No second user table, no role matrix.
- Google says *who* you are. `ADMIN_EMAILS` says whether that is anybody here: an
  account Google signs in perfectly happily still gets a 404.
- Every page and every server action calls `requireAdmin()` itself. Signed out
  goes to the panel's sign-in; everything else — a buyer's account, a typo in the
  list, a blocked address — gets a plain `notFound()`, so the panel never
  confirms to a stranger that it exists or whose account would open it.
- `noindex, nofollow` on every response, `robots.txt` disallows `/admin`,
  `frame-ancestors 'none'`, `Cache-Control: no-store`.

**There is no IP allowlist, on purpose.** One was built and then removed on
2026-09-15 after testing it. Behind a proxy the only address that can be trusted
is the last hop of `x-forwarded-for`, and behind Hostinger that is the proxy's
own address — never the operator's. Setting the allowlist would have matched
nothing and locked the one person who could fix it out of the panel for good.
Trusting the client's claimed address instead would have made it bypassable with
one header, which is worse than having nothing: an access control that is not one
still gets believed. Google plus `ADMIN_EMAILS` is the control.

There is no rate limiting to write here any more: the only credential is
Google's, and Google does its own.

### The shape of a screen

A rail down the **left** (Rajan, 2026-09-15 — he asked for a sidebar, not a
header, and then for the left rather than the right). It carries the nine
sections with an icon each, marks the one you are on, and keeps the signed-in
address and Sign out at its foot.

It is rendered once by `app/admin/layout.tsx`, not by each page, so a screen
cannot be added that quietly has no way out of itself. Below 900px it stops being
a rail — a full-height column on a 375px screen would leave the tables no room —
and becomes a bar across the top whose links scroll sideways.

The look is a working tool: one neutral ground, one accent borrowed from the site
so the two read as one product, one elevation step. Emphasis is spent on the
things that cost money to misread — the billing alert, the test-mode banner, the
destructive buttons — and withheld everywhere else, so that when something is
coloured it means something.

### Audit log

Every state-changing admin action writes one row, before the change is reported as
done. This matters here more than anywhere: an admin can grant Premium, revoke it,
and delete an account.

```sql
public.admin_audit (
  id, actor_email, action, subject, before jsonb, after jsonb, at timestamptz
)
```

In `public` rather than `private` because PostgREST only exposes `public`; RLS is
on with no policy at all, so `anon` and `authenticated` reach nothing.

Append-only, and meant: UPDATE, DELETE and TRUNCATE are refused by triggers, which
fire for every role including the superuser. Rewriting history now takes a
migration — itself a reviewed, committed, visible act. Read-only in the UI.

---

## 3. Modules

### 3.1 Dashboard

Accounts total, Premium holders, signups today / 7d / 30d, revenue (count times the
`plans.ts` amount), purchases stuck outside a terminal state, webhook deliveries
that failed, and the reconciliation alert below.

**Reconciliation alert.** A captured payment whose account has no active
entitlement in the current mode. Expected count: zero. Anything else is a buyer who
paid and did not get what they paid for, and it goes at the top of the dashboard in
red. Compares `payments` (status `captured`) against `purchases.state` and
`entitlements`.

### 3.2 Users

List with search (email), filter (Premium / free / unconfirmed), sort, pagination,
CSV export. Detail shows: email, confirmed, created, last sign-in, entitlement,
purchases, registered push devices, reminder settings, and the size of their synced
data. **Not** their counter history — support never needs to read someone's
practice, and the DAL is not going to grow a way to.

### 3.3 User actions

Confirm an email by hand, send a password-reset link, export the account's data
(the same export the account page offers), delete the account through the existing
tombstone flow. Each writes an audit row. No impersonation: with one operator it
buys nothing, and it would need a new session-minting path that does not exist.

### 3.4 Purchases and payments

Every order, not only the searched one: state filter, date range, CSV export. Per
order — Razorpay payment ids, amount, method, status, refund state, the account it
landed on, and the state history. Re-run a stuck purchase — which calls
`reconcile()` directly, so it can only confirm what Razorpay confirms.

### 3.5 Webhook log

`webhook_events` as a list: type, mode, received. The event id is the primary
key, which is the deduplication: a retried delivery collides with itself and is
discarded, so a webhook cannot pay for anything twice.

**No replay button, deliberately.** Replaying a stored event would mean trusting
our copy of what Razorpay said. Re-running the purchase asks Razorpay again,
which is both safer and the thing support actually wants; it lives on the
purchase page.

### 3.6 Entitlements and restore purchase

Grant or revoke by hand, with a required reason that goes into the audit row. And
restore: find a payment by checkout email or payment id and attach its entitlement
to the account that is actually signed in now — the "I paid with one email and
signed in with another" case, which is the single most likely support ticket this
product will get.

### 3.7 Payment mode switch

`private.app_config.payment_mode`, test to live, from a screen instead of a manual
SQL statement. Going live is currently a hand-written database update, which is
exactly the kind of thing this panel exists to remove. Guarded by a typed
confirmation, because flipping it invalidates every entitlement in the other mode.

### 3.8 Kill switches and feature flags

One table, read by the site and written by the panel, cached for a minute:

```text
payments      google_login   cloud_sync   reminders
ads           promo_bar      maintenance_mode
```

**The counter is not on this list and never will be.** Every switch above can be
off and the local counter still counts, still saves, still shows the streak. That
is the product's core promise, and no admin control may break it.

### 3.9 Name library

The one piece of content management. `NAMES` in `src/lib/counter/names.ts`
moves to a `public.names` table: Devanagari, transliteration, meaning, group,
order, published flag.

**Ids never change.** A practice's history is stored under the id; renaming an id
orphans someone's counts. The admin UI makes the id read-only after creation and
offers unpublish, never delete.

**D2, decided 2026-09-15: the page carries the library, and the bundled list is
the fallback.** The home page is regenerated at most once a minute
(`export const revalidate = 60`) and inlines the published rows as
`window.__njcNames` before the engine starts. So an edit is live within the
minute with no deploy, the page stays a prebuilt file served from cache, and
there is no second fetch that would make the counter boot with one list and swap
to another while somebody is mid-practice.

The cost was 40 bytes of the counter's first-load budget, for a `library()` that
prefers the injected list and returns the bundled one otherwise. That fallback is
not a nicety: it is what keeps the counter working offline, on an old cached
page, and on a build with no database configured at all.

### 3.10 Reminders and devices

How many accounts have reminders on, when the scheduler last ran, what it sent,
what failed, and which push tokens are dead. Clear dead tokens.

### 3.11 Ads

AdSense on/off, per-page placement, and the protected-surface rule kept from the
source specification: **no ad inside or beside the counter**. The placement UI does
not offer that position at all, rather than offering it and warning about it.

### 3.12 Analytics

Signups, visit-to-purchase funnel, total japs synced, which names are used most,
retention.

> **Honest limit.** Free users' counts live only in their own browser — that is by
> design (docs/ARCHITECTURE.md). Every number here therefore describes **signed-in
> Premium users only**. Whole-site traffic stays in Google Analytics. The screen
> says so, on the screen, so a later reader does not mistake it for everything.

### 3.13 System

Environment and build info, which Supabase project and Razorpay mode are live,
error log, cron status, row counts per table, last backup, and a cache purge that
revalidates the public site's static pages.

---

## 4. What was cut from the source specification

Roles and a permission matrix (one operator), blog and CMS, media library, SEO
manager, i18n manager, themes, leaderboard and its fraud rules, achievements, the
dhikr and 99-names libraries, guided routines, the religious review workflow,
subscriptions, renewals, grace periods and dunning, multi-currency and per-country
pricing, coupons, comments, and a support ticket system — the contact page is
static copy with an email address behind it.

---

## 5. Phases

| Phase | Contents | Ends when |
|---|---|---|
| A ✅ | This document, the panel's scaffold, admin auth + audit table, deploy shape proven | An empty guarded panel builds and answers on the subdomain |
| B ✅ | Dashboard, users, user actions | The reconciliation alert reads zero against live data |
| C ✅ | Purchases, webhooks, entitlements, restore, payment-mode switch | Rajan's own test purchase is visible and re-runnable end to end |
| D ✅ | Kill switches, ads, name library | Every switch off, counter still counts |
| E ✅ | Reminders, analytics, system, CSV exports | `npm run check` green in both apps, e2e green |

Each phase ends at zero errors. Nothing is deferred into the next one.

### What was proved, and how (2026-09-15)

`npm run check` green: typecheck, lint, 459 unit tests, secret scan, the
auth-handler scan, the admin guard scan (28 files, every entry point guarded),
`npm audit` 0 vulnerabilities, production build, bundle budget.

Against the built site, reading the pages rather than assuming:

- **The subdomain.** `/admin/*` on the main domain is a 404; every path on
  `admin.localhost` is rewritten into the panel, and `/auth/*` and `/api/*` are
  not. All fourteen public URLs still answer 200 after the route-group move.
- **The panel's door.** Twenty routes — pages, CSV exports, the JSON export —
  each send a signed-out request to the sign-in and render nothing.
- **Google only.** The sign-in page has one button, zero password fields and zero
  "forgot" links.
- **No site furniture on the panel:** no header, no promo bar, no analytics tag,
  no AdSense loader, `window.adsbygoogle` undefined, zero ad units.
- **The site is untouched:** header, promo bar, counter, 45 names, skip link,
  `main#content`, AdSense loader in `<head>`.
- **The counter, with every switch off.** Payments, Google sign-in, sync,
  reminders, ads and the promo bar all off and maintenance on — 115 taps became
  126, the streak held, storage saved. The API routes refused as they should:
  `payments_off`, `sync_off`, "reminders are switched off", and the Google button
  gone from `/login/`.
- **The name library end to end.** Hiding `kali` in the database dropped the
  page's inlined list from 45 names to 44, within the minute, with no deploy.
- **The database, against the live project.** 20/20 on the existing RLS matrix
  after the migrations, and 13/13 on the admin rules
  (`scripts/verify-admin-remote.mjs`) — a visitor can read the names and switches
  and write neither, a name cannot be renamed or deleted by anyone including the
  superuser, no `counter` switch can be created, the audit log cannot be
  rewritten or cleared.
- **Every screen's data.** `scripts/probe-admin.mjs` ran all 22 reads the panel
  does against the live project: 3 accounts, 3 Premium, ₹600 captured, 0
  unreconciled, 41 purchases, 45 names.

### Driven end to end in a real browser (2026-09-15)

Signed in with Google in Rajan's own Chrome, on `admin.localhost:3105`, every
screen opened and every action run:

| Tried | Result |
|---|---|
| Google sign-in | account chooser, straight into the dashboard |
| Users: search, filter, CSV | 1 match on "qa1"+Premium; three CSVs, correct headers, UTF-8 BOM present |
| Revoke Premium with no reason | refused by the SERVER, with the browser's `required` removed |
| Revoke, then grant back | Free → entitlement row kept and marked revoked → Premium again |
| Suspend, then restore | suspended to 2126, button flipped to Restore, restored to active |
| Delete with the wrong email typed | refused, account untouched |
| Send password reset | sent, and the link points at localhost — see §1 of request-origin |
| Purchase detail + re-run | called Razorpay live; "nothing changed — still created", correctly |
| Restore onto another account, bad id | refused |
| Payment mode: wrong word typed | refused, mode unchanged |
| Payment mode: test → live → test | 3 Premium/₹600 → 0/₹0 → 3/₹600. Nothing lost |
| Ads switch off, then on | the site stopped loading AdSense entirely; counter unaffected |
| Name: position edit, hide, show | saved, "44 offered · 1 hidden", restored |
| Add a name with an existing id | refused: ids are permanent |
| Audit log | every one of the above recorded, with its reason |

Four bugs this found that nothing else had:

1. **Opening a user's page performed an export.** Next prefetches `<Link>`, and
   prefetching a route handler runs it — the audit log filled with a
   `user.export` nobody asked for. Every download is a plain `<a>` now.
2. **Two redirects had lost their `/admin` prefix** in the move from a separate
   app, both inside multi-line calls a one-line search had missed. They only fire
   on error paths — "that id already exists", "now live" — so they would have
   been found by a stranger, months later, as a 404. `tests/unit/admin-redirects.test.ts`
   now reads every redirect target in every admin action.
3. **The analytics funnel read "1400% of accounts"**, arithmetically true and
   useless: payment comes first here, so most checkout emails never become
   accounts.
4. **`100vh` measured 641px in a 591px viewport**, putting Sign out below the
   fold on a rail that otherwise fit exactly. `100dvh`, with `vh` as fallback.

Still not exercised on a real phone: the panel's narrow layout. The rules were
forced on and measured — rail on top, 44px targets, no sideways scroll — but the
breakpoint itself has only been read, not fired. Worth thirty seconds on a phone
after the subdomain is live.

The database work is tested against a real Postgres, not reasoned about:
`site/tests/unit/db/admin.test.ts`, 32 tests in PGlite running the actual
migrations. It checks the arithmetic — the dashboard's counts, the funnel, the
filters — and, more importantly, the promises:

- a name id cannot be changed and a name cannot be deleted, **by anyone**,
  superuser included;
- the audit log cannot be updated, deleted or truncated, superuser included;
- `app_flags` refuses a row called `counter`, or anything else not on its list;
- a visitor can read the switches and the published names, and can write neither;
- switching payment mode makes the other mode's Premium stop counting at once.

Three bugs the tests found that reading the code had not:

1. **`admin_overview()` called `admin_reconciliation()` before it was defined.**
   Postgres resolves a SQL function body at creation, so the migration simply
   failed. A syntax-level mistake that only running the migration reveals.
2. **`timer_components` no longer exists** — Phase 10 dropped it — and the row
   counts still asked for it.
3. **The reconciliation query could not see a deleted account.** Deleting one sets
   `purchases.user_id` to null, so looking the tombstone up by id matched nothing
   and every buyer who had ever deleted their account showed as an unpaid alarm.
   The fix distinguishes the two ways a purchase ends up with no account, by its
   own state: `notified` means it worked and its owner later removed it; anything
   earlier means the money arrived and no account was ever made, which is the
   worst version of this bug and must **not** be filtered away with the others.

Three more, found by running the thing rather than reading it:

4. **The kill switches read through a React context** cost ~200 bytes and pushed
   the counter page past its first-load budget. The ads switch is now a
   `data-ads` attribute, the pattern `data-premium` already uses for the same job.
5. **An ad appeared on the panel's own sign-in page.** See §1: Auto Ads do not go
   through `AdSlot`, and `pauseAdRequests` does not survive the loader. The loader
   moved into `app/(site)/`.
6. **`/auth/callback/` would have been rewritten on the subdomain**, so Google
   sign-in would have failed at the last step with Google reporting success. The
   proxy now passes `/auth`, `/api` and `/_next` through unchanged.

And one in a tool rather than the product: `check-auth-handlers.mjs` took the
first `{` after a function's name as its body, which for a handler written
`GET(request, { params })` is the parameter object. It reported a guarded route as
unguarded — and the same mistake the other way would have passed an unguarded one.
Fixed, with a test of its own.

---

## 6. Blocked on Rajan

1. ~~A second Node application on Hostinger.~~ No longer needed: one project, one
   deployment (§1). Hostinger confirmed the Business plan would allow two, which
   is worth knowing and is no longer used.
2. **Create the subdomain** `admin.bhaktinamjap.com` in hPanel and point it at the
   **same** Node application the site runs on — not a new one. No second Git
   deployment, no second build, no second set of environment variables
   (docs/DEPLOY.md §8).
3. ~~Apply the three migrations.~~ Applied on 2026-09-15 and verified: 20/20 on
   the RLS matrix, 13/13 on the admin rules, 22/22 reads from every screen.
4. **First sign-in.** Open the subdomain and press Continue with Google. The
   account must be the one in `ADMIN_EMAILS`; anything else gets a 404. **Turn on
   2-Step Verification on that Google account** — it is the panel's second factor
   and nothing in this code can check that it is on.
5. ~~Two new environment variables.~~ Not needed either: there is no internal API
   between two applications any more.
6. ~~Decision D2.~~ Decided and built — see §3.9.

## 7. What replaced the old support view

The one-page support view that used to live at `/admin/` — search a purchase,
re-run it — is gone. Its two jobs are now the Payments list and the purchase
detail screen, which do the same thing and more. `lib/admin-store.ts` went with
it; `lib/admin/db.ts` is its replacement.
