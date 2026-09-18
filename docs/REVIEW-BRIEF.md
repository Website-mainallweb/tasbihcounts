# Review brief — Tasbih Counts premium build

Paste this whole thing into a second opinion and ask it to poke holes. It is
self-contained: everything decided so far, and why.

---

## What the product is

A devotional chant counter ("nam jap"). The user taps a button; each tap is one
repetition of a divine name. 108 taps is one *mala* (a traditional rosary round). People
use it daily, often for years, and the accumulated count matters to them emotionally —
losing it is the worst possible failure.

Originally a WordPress site, rebuilt as a Next.js 16 app (App Router, TypeScript strict,
deployed on Hostinger from GitHub). Today it is entirely client-side: all state lives in
one object in `localStorage`, there is no backend, no accounts, no cookies. It is
monetised with Google AdSense. Traffic is mostly mobile, mostly India.

## What is being added

1. A **premium plan** — Rs 200, one-time, lifetime. No trial, no subscription, no
   cancellation. Refunds only where a technical payment failure took the money without
   granting access.
2. **Login, but only for people who paid.** Nobody else can register at all.
3. **Cloud sync** of counter data for premium users.
4. Ads removed for premium users.
5. New screens modelled on a competitor Android app: bottom nav (Counter / Stats /
   Library / Settings), a Streak page (current + best streak, week strip, month
   calendar), a Stats page (Naam/Timer toggle, Daily/Monthly/Yearly, bar chart, per-name
   filter), jap reminders and a 9 PM streak reminder via FCM.

Deliberately rejected from that competitor app: custom photo backgrounds, background
music, blackout mode, manually adding logs for past days, a chime at 108, in-app
feedback and invite-friends. A single Support entry survives as an email link.

Hard constraint: mobile, tablet and desktop each get their own layout. One width scaled
across all three is not acceptable.

## Stack chosen

- Next.js 16 (App Router) on a Node server — the config uses `headers()`, so it is not a
  static export and route handlers are available
- Supabase — Postgres + Auth (Google OAuth + email OTP)
- Razorpay for payments (India), currently test keys
- Firebase Cloud Messaging for web push (chosen over raw Web Push / self-generated VAPID)
- Google Cloud and Firebase share one project, `bhakti-nam-jap`

---

## Decision 1 — sync without an API call per tap

**The worry:** if every tap hits the backend, a 30-minute session is thousands of
requests and the serving bill explodes.

**What we found:** the local layer already survives crashes. `count()` calls `save()` on
every tap and `save()` is a synchronous `localStorage.setItem`, which writes to disk. A
browser crash, a force-close, or the phone's battery dying loses nothing. So the backend
is not crash protection. It is only for: cleared browser data, a second device, a lost
phone, and iOS Safari evicting storage.

**The design:**

- **Outbox in the same localStorage write.** Each save stamps `S.pending` with the
  absolute day record — no extra cost, it rides along in the write that already happens.
- **A separate flush loop drains it.** A failed flush leaves the entry in place, so it
  goes out whenever the app next opens. Delivery is eventual but guaranteed, across
  offline periods of any length.
- **Flush triggers:** 10s idle, mala completion, a 60s max-staleness cap, and
  `pagehide` / `visibilitychange` via `navigator.sendBeacon` (which completes as the tab
  closes).
- **Absolute values, never increments.** `PUT {day, c: 432}`, not `POST {delta: +1}`, so
  a retry cannot double-count.
- **The server merges with `GREATEST`,** since counts only rise. That makes retries
  idempotent, ignores late-arriving stale writes, and lets two devices run at once
  without either losing data.
- `navigator.storage.persist()` on load, to stop iOS evicting.

**Cost:** roughly 1–2 calls per mala, 5–40 per user per day. 10k daily users lands
around Rs 400–2000/month.

**Residual risk:** a phone destroyed permanently within the 60s window loses up to 60
taps. The only way to reach zero is a call per tap.

## Decision 2 — login exists only for buyers

The chicken-and-egg problem: you need an account to buy, but accounts only exist for
buyers. Resolved with a **pay-first flow** — the account is created *by* the payment:

```
Plan page -> Buy -> Razorpay collects the email -> payment succeeds
  -> webhook creates the user via admin.createUser, keyed to that email
  -> email tells them to log in
  -> Google or email OTP -> premium active
```

A failed payment creates no account, so there is no way to register without buying.

**Enforcement:** Supabase's "Enable signups" is turned OFF, and users are created only
by the webhook. Both Google OAuth and email OTP then work solely for emails that already
exist; everyone else is refused.

**Known support burden:** someone pays with one email and then signs in with a different
Google account, locking themselves out. Mitigation planned from day one — say "use this
same email" prominently on the payment page, and mail a redeem code that can rebind.

**Free users** keep everything locally and move it with an export/import JSON file that
already exists in the app. Three fixes needed to make that a real backup: the current
import *overwrites* all state from the file (so restoring an old backup wipes newer
days — it needs a per-day `Math.max` merge), `storage.persist()`, and a nudge when no
backup has been taken in 30 days.

## Decision 3 — security enforced in code, not in a checklist

Written before any of the auth/payment/sync code exists, so nothing is retrofitted.
Every rule names the mechanism that makes the mistake impossible or loud.

- **Secret boundary:** `import "server-only"` plus zod-parsed env at module load, an
  ESLint `no-restricted-imports` rule, and a grep in CI for
  `NEXT_PUBLIC_*(SECRET|SERVICE_ROLE|TOKEN)`.
- **Supabase:** RLS enabled in the same migration that creates each table, with **both**
  `using` and `with check` — `using` alone lets a user move a row onto another user's
  id. RLS failures return *empty results*, not errors, so isolation tests assert on rows
  rather than on the absence of an error. The service role key is used in exactly two
  places: the webhook and scheduled jobs.
- **Auth:** middleware is *not* treated as a security boundary. Two 2026 CVEs
  (CVE-2026-44575 via crafted `.rsc`/segment-prefetch URLs, CVE-2026-64642 via Turbopack
  with a single i18n locale) let requests skip middleware entirely. Auth lives in a data
  access layer that every route handler and server action calls for itself, using
  `getUser()` (which revalidates with the auth server) and never `getSession()` (which
  trusts the cookie). `"use server"` adds no authentication of its own.
- **Payments:** the webhook verifies `X-Razorpay-Signature` as HMAC-SHA256 over the
  **raw** body (`req.text()` — parsing and re-serialising changes the bytes and the
  signature never matches), compared with `timingSafeEqual` rather than `===`. A valid
  signature proves Razorpay sent it, not that the right amount arrived, so `amount ===
  20000` and `currency === "INR"` are checked separately. `razorpay_payment_id` is a
  primary key for idempotency, and duplicates return 2xx so Razorpay stops retrying.
- **Entitlement** is a database fact. Hiding ads on a cached client flag is fine; sync,
  restore and anything costing money check the server every time.
- **Sync endpoint:** zod at the boundary, `user_id` from the session and never from the
  body, per-user rate limiting.
- **Import file is untrusted input** — every field pinned to a known type, string lengths
  capped, history entry count capped.

**Build order,** chosen so each step's protections exist before the step needing them:
guardrails → schema + RLS → DAL → auth → payments → sync → FCM.

## Decision 4 — guardrails before features

Currently the repo has TypeScript strict and nothing else: no ESLint config, no tests,
no git hooks, no CI. Planned before feature work:

- One `npm run check` = typecheck + lint + test + `npm audit` + build, wired to a
  `pre-push` hook
- Playwright at three viewports (375×812, 768×1024, 1440×900) asserting no horizontal
  scroll and no CSP violations in the console
- Vitest on the four logic areas where bugs actually live: counter merge, streak
  calculation, sync outbox, day rollover
- A JS size budget that fails the build

Definition of done per feature: types pass, logic tested, correct at three viewports, no
console errors, keyboard and screen-reader usable.

---

## Where a second opinion would help most

1. Is the outbox + absolute-values + `GREATEST` design right, or is there a failure mode
   we have not thought of? Particularly around multi-device, clock skew, and the day
   rollover boundary (day keys are local dates — what happens when a user travels?).
2. Is pay-first account creation the right call, or does the email-mismatch lockout cost
   more in support than an ordinary "register then buy" flow would cost in abuse?
3. Rs 200 lifetime with no trial and no subscription — is a one-time price the right
   model for an app whose main premium value (cloud sync) is an ongoing server cost?
4. Anything missing from the security design, especially around Supabase RLS and the
   Razorpay webhook.
5. Is FCM the right choice for web push here, given iOS only delivers to users who have
   added the site to their home screen?
