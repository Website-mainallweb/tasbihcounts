# Security — enforced in code, not in a checklist

A checklist is a promise to remember. This file records, for each way the site could be
broken into, the mechanism that makes the mistake impossible or loud — a type error, a
lint failure, a database policy, a test. If a rule here has no enforcement column, it is
not a rule yet; it is a hope.

Written 2026-09-09, before the login, payment and sync work began, so that none of it
has to be retrofitted. Scope: the premium plan (Rs 200 lifetime), Google/email login for
buyers only, counter sync to Supabase, Razorpay payments, FCM reminders.

---

## 0. The three questions

Every piece of this feature set reduces to one of:

1. **Who is asking?** — authentication
2. **Are they allowed?** — authorisation, checked at the data, not at the door
3. **Is this really from who it claims?** — webhook and token signature verification

Most breaches of an app this shape are #2 answered in the wrong place, or #3 skipped.

---

## 1. The secret boundary

The service role key and the Razorpay secret are the two credentials that end the game
if they leak. `NEXT_PUBLIC_` is the only thing standing between a variable and the
browser bundle, and it is one typo wide.

**Enforcement:**

```ts
// src/lib/env.server.ts
import "server-only";          // build fails if a client component imports this
import { z } from "zod";

const schema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
  RAZORPAY_KEY_SECRET: z.string().min(20),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(24),
  GOOGLE_CLIENT_SECRET: z.string().min(20),
});

export const env = schema.parse(process.env);
```

`import "server-only"` turns a client-side import into a build error rather than a
runtime leak. Parsing at module load means a missing or truncated key kills the boot
instead of failing on the first payment at 2am.

Add the lint rule so nobody reaches around it:

```js
// eslint.config.mjs
"no-restricted-imports": ["error", {
  patterns: [{
    group: ["**/env.server", "**/supabase/admin"],
    message: "Server-only module. Move this call into a route handler or server action.",
  }],
}],
```

And a grep in `npm run check` for the one mistake lint cannot see — a secret that
someone renamed into the public namespace:

```bash
grep -rE "NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE|PRIVATE|TOKEN)" src/ && exit 1
```

**Never:** log a token, a key, or a full JWT — not even at debug level, not even
truncated "just to check". Logs get shipped, pasted and screenshotted.

---

## 2. Supabase — the database is the security boundary

The anon key ships in the JavaScript bundle. That is by design and it is safe **only**
while row-level security is on and correct. A table without RLS is a public API.

**Enforcement — deny by default, in the migration itself.** Every table, in the same
migration that creates it, never as a follow-up:

```sql
create table progress (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  c       integer not null default 0 check (c >= 0),
  primary key (user_id, day)
);

alter table progress enable row level security;

create policy "own rows only" on progress
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

`using` governs what can be read and which rows an update may touch; `with check`
governs what a row may become. A policy with `using` alone lets a user *move* a row onto
someone else's `user_id`. Both, always.

**A test, not a promise.** One test per table, signed in as user A, asserting that user
B's row is invisible:

```ts
test("progress rows are private", async () => {
  const a = await signInAs("a@test.com");
  await a.from("progress").insert({ day: "2026-09-09", c: 5 });
  const b = await signInAs("b@test.com");
  const { data } = await b.from("progress").select();
  expect(data).toEqual([]);        // not null, not an error — empty
});
```

RLS failures return *empty results*, not errors. A test asserting "no error" passes
while the data is wide open. Assert on the rows.

**Never** reach for the service role key to make a failing query work. When a query
fails under RLS the policy is wrong; the service role key is the tool that hides the
bug and hands the whole database to whoever finds the key. Service role belongs in
exactly two places here: the Razorpay webhook (which has no user session) and any
scheduled job.

**Key deprecation:** Supabase is retiring `anon` and `service_role` keys by the end of
2026, replacing them with publishable (`sb_publishable_…`) and secret (`sb_secret_…`)
keys. The ones in `.env.local` are the old style and expire in 2036, so nothing breaks
today, but the migration should happen before launch rather than after — the new secret
keys can be rotated without re-issuing every token, which the old ones cannot.

**Rotate before launch:** the service role key and the `sbp_` personal access token were
pasted into a chat transcript. The `sbp_` token is account-wide — it reaches every
project on the account — and the app does not need it at all; it is for the CLI. Revoke
it.

---

## 3. Auth — middleware is not a security boundary

This is the year's most expensive lesson. Two 2026 CVEs let a request skip middleware
entirely and land on the Server Component renderer:

- **CVE-2026-44575** — crafted `.rsc` and segment-prefetch URLs bypass middleware rules
  in App Router setups.
- **CVE-2026-64642** — Turbopack builds with a single `i18n.locales` entry allow a
  middleware/proxy bypass.

The patches matter (this project is on Next `^16.3.4`, past the 16.2.11 fix line), but
the architectural lesson outlives the CVE: **middleware runs at the edge for routing and
response shaping, not as a last line of defence.** Any protection that exists only in
middleware is one routing bug away from gone, and there will be another routing bug.

**Enforcement — a data access layer no route can bypass.** Every read of user data goes
through one module that starts by resolving the session itself:

```ts
// src/lib/dal.ts
import "server-only";
import { cache } from "react";

export const requireUser = cache(async () => {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();   // verifies with the
  if (!user) throw new Unauthorized();                        // auth server
  return user;
});
```

Use `getUser()`, never `getSession()`, on the server: `getSession()` reads the cookie
and trusts it, `getUser()` revalidates the token. A forged cookie passes the first and
fails the second.

Every route handler and every server action calls `requireUser()` **itself**, even when
middleware already checked. `"use server"` adds no authentication of its own — a server
action is a public POST endpoint with a nice syntax. Redundant checks are the point:
the second one is what survives when the first is bypassed.

**Signups stay closed.** Login exists only for people who paid. Supabase Auth's
"Enable signups" is OFF; users are created solely by the payment webhook via
`admin.createUser`. Both Google OAuth and email OTP then work only for emails that
already exist, and everyone else gets a refusal. This is a config setting with no code
to protect it, so it needs a test that attempts a signup and asserts it fails, run in
CI — otherwise a console click six months from now silently opens the door.

**Entitlement is never a client fact.** `premium_until` lives in the database and is
read server-side. Hiding `AdSlot` on a cached client flag is fine — a user who edits
localStorage to hide their own ads has achieved what an ad blocker already does. But
cloud sync, restore, and anything that costs money must check the database row on the
server, every time.

### Added 2026-09-12 — signing in with a password

Rajan asked for an email-and-password sign-in beside the link and Google, with no 2FA and
with guessing shut out. Accounts are still created **only** by a completed payment; a
password is chosen afterwards, on the account page.

- **The password never goes to Supabase from the browser.** `/api/auth/password/` takes it,
  counts the attempt, and signs in with the cookie client, so the session lands in the same
  cookies every page reads.
- **One sentence for every refusal.** Wrong password, no such account, an account with no
  password: all answer *"That email address and password do not match an account."* The form
  must never become a way to learn which addresses are customers. `/api/auth/recover/`
  answers `{ ok: true }` for every address, for the same reason.
- **Throttle (`src/lib/auth-throttle.ts`).** Six attempts per address and fifteen per network
  in ten minutes; five failures lock an address for fifteen minutes, twenty-five from one
  network lock it for an hour. The client address is the FIRST entry of `x-forwarded-for` — a
  header the caller can forge only to shrink its own bucket. In memory, like the sync
  limiter: enough for one Node process, and it forgets on a restart, which errs towards
  letting a real person in.
- **Supabase settings** (changed with Rajan present, 2026-09-12): minimum password length
  **10**, and replacing a password requires the current one. Leaked-password checking
  (HaveIBeenPwned) and editable email templates are Pro-plan features on this project and are
  **not** on — see the note below.
- **Setting or changing a password is by email only (redesign, 2026-09-13).** The account
  page has no password form and `/api/auth/password/set/` is gone: knowing a signed-in
  browser is not enough, the mailbox is needed too. "Forgot password?" and the account page's
  "Email me a password link" both call `/api/auth/recover/` — the sign-in throttle plus at
  most **3 reset mails an hour per address** — which asks Supabase to mail the reset link.
- **The reset link spends nothing when opened.** It points at `/auth/reset/?token_hash=…&type=recovery`
  (the Supabase "Reset password" template must build exactly
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`). The first script in `<head>`
  moves the token out of the address bar before AdSense or analytics can read it; the page
  carries a `no-referrer` policy. Only the **Set new password** button posts it to
  `/api/auth/reset/`, which verifies it with Supabase and sets the password (min 10, a letter
  and a digit, not containing the address; 20 tries per network per 10 minutes). A mail
  scanner that opens the link sees a form and leaves.
- **A refused first try does not need a new link.** The token is spent before the route can
  know the address, so a verified token leaves a one-time **reset grant** — random, in server
  memory and an httpOnly `SameSite=Strict` cookie scoped to `/api/auth/reset/`, bound to the
  user, 15 minutes from the token's use, spent on success (`src/lib/reset-grant.ts`). A plain
  signed-in session cannot stand in for it: Supabase marks a reset session `amr: otp`, exactly
  like a sign-in code (probed live 2026-09-13), so the session alone proves nothing.

**The email was the weak part, and it was a plan limit rather than code — now settled
(2026-09-12).** A one-time link dies the moment anything opens it; a mail provider checking it
for phishing is enough, which is exactly what happened when a link was clicked from Gmail that
morning. The fix is a code the reader types, which nothing can consume on their behalf.

Custom SMTP is now configured on the Supabase project: **smtp.hostinger.com:465 (SSL)**,
username and sender `contact@bhaktinamjap.com`, sender name "Bhakti Nam Jap" — the mailbox of
the site's own domain, so SPF and DKIM are Hostinger's and the mail lands in the inbox rather
than spam (verified: both test mails arrived in Gmail's inbox). The password was typed by
Rajan; it is held encrypted by Supabase and exists nowhere in this repo.

What that unlocked, all of it on the **free** Supabase plan:

| Before | After |
|---|---|
| templates locked ("set up custom SMTP to edit templates") | both templates rewritten to carry `{{ .Token }}` |
| 2 emails an hour for the whole project | **30 an hour** (raised automatically with custom SMTP) |
| link only | link **and** a **6-digit** code (Email OTP length 8 → 6; expiry already 900 s, which is the "15 minutes" the copy promises) |

`NEXT_PUBLIC_EMAIL_CODE=1` is set in `site/.env.local` **and** in the Hostinger web app's
environment variables, because a NEXT_PUBLIC_* flag is baked in at build time — unset there,
the code box would simply be missing from the production bundle.

Both flows were driven end to end in Rajan's own browser on 2026-09-12: a sign-in code
(6 digits) signed in to `/account/`, and a reset code opened the account page with a recovery
session, where a new password is set without the old one.

Two details the first cut got wrong:

- The code box lived only on the "check your email" screen, so anyone who read the mail in
  another app and came back to a fresh page had to ask for a second email — and could meet the
  rate limit doing it. The by-email form now offers **"I already have a code"**, which opens
  the box with its own address field and sends nothing. (The forgot form had one too, for a
  recovery code; since 2026-09-13 a reset is a link with a button instead — see above.)
- `tests/e2e/email-code.spec.ts` proves the path with REAL codes: `admin.generateLink` mints the
  same token the mail carries without sending one, so a wrong code, a real code and a code used
  twice are all checked without spending the project's email allowance. It needs the Supabase
  host reachable — `blockThirdParty(page, [host])` — because this verification happens in the
  browser, not on our server.

---

## 4. Payments — assume the webhook URL is public, because it is

`/api/razorpay/webhook` will be found. The only thing separating a real payment from a
stranger posting `{"event":"payment.captured"}` is the signature.

**Enforcement — raw body, HMAC, timing-safe compare, before anything else:**

```ts
export async function POST(req: Request) {
  const raw = await req.text();              // RAW. Never req.json() first —
  const sig = req.headers.get("x-razorpay-signature") ?? "";

  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(raw)                             // ...re-serialising changes the bytes
    .digest("hex");                          // and the signature will never match

  const ok =
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));

  if (!ok) return new Response("bad signature", { status: 400 });

  const event = JSON.parse(raw);             // only now is this trustworthy
  ...
}
```

Three details that are each a whole bug:

- **Raw body.** Parsing and re-stringifying the JSON reorders keys and changes
  whitespace. The signature is over bytes. `req.text()` first, always.
- **`timingSafeEqual`, not `===`.** String comparison exits at the first differing
  character, which leaks the signature one byte at a time to anyone patient. Lengths
  must be compared separately because `timingSafeEqual` throws on a length mismatch.
- **Test and live have different secrets.** The current keys are test-mode. Swapping to
  live means swapping the webhook secret too, and forgetting produces a webhook that
  silently rejects every real payment.

**Verify the money, not just the signature.** A valid signature proves Razorpay sent it,
not that the right amount arrived. Check `amount === 20000` (paise) and
`currency === "INR"` before granting anything. Otherwise a Rs 1 order carries a
perfectly valid signature to lifetime premium.

**Idempotency.** Razorpay retries on any non-2xx, and delivers at-least-once even when
you succeed. Store `razorpay_payment_id` with a unique constraint and let the second
delivery collide harmlessly:

```sql
create table payments (
  payment_id text primary key,          -- the idempotency key
  email      text not null,
  amount     integer not null,
  created_at timestamptz default now()
);
```

Return 2xx for a duplicate. Returning an error makes Razorpay retry forever.

**Never trust the client's word for a payment.** The browser's success callback is a
hint to update the UI, nothing more. Entitlement is granted by the webhook, server-side,
or it is not granted.

---

## 5. The sync API — the endpoint that will be hammered

`PUT /api/progress` is authenticated, high-frequency, and takes user-controlled numbers.

- **Validate with zod at the boundary.** A `day` that is not a date, a `c` that is
  negative or `1e9`, a hundred thousand history keys in one payload — reject the shape
  before it reaches the database. `z.coerce.date()`, `z.number().int().min(0).max(1e7)`,
  and a cap on array length.
- **Authorise per row, not per request.** The `user_id` comes from the session, never
  from the body. If the body carries a `user_id`, ignore it.
- **Absolute values plus `GREATEST`** (see the sync design) make every write idempotent,
  so a replayed request cannot inflate a count.
- **Rate limit.** The debounced client sends a handful of writes per day; anything
  sending hundreds per minute is not the counter. A per-user limit protects the bill as
  much as the data.
- **Never build SQL by string concatenation.** Supabase's client parameterises; raw SQL
  in an RPC must use parameters too.

---

## 6. Content Security Policy

`next.config.mjs` already carries a real CSP, and it is about to need three new origins:
Supabase (`connect-src`), Firebase/FCM (`script-src` for gstatic,
`connect-src` for `fcmregistrations.googleapis.com` and `fcm.googleapis.com`), and
Razorpay (`script-src` for `checkout.razorpay.com`, `frame-src` for
`api.razorpay.com`).

The failure mode is silence: a blocked origin produces a console error nobody is
watching and a checkout button that does nothing. Add a Playwright assertion that the
console has no CSP violations on the pages that load these scripts.

The policy carries `'unsafe-inline'` and `'unsafe-eval'` for AdSense and the inline
theme bootstrap. That is a real weakening and it is deliberate — a prerendered page has
no request on which to mint a nonce. It raises the cost of any XSS, which makes the
next rule matter more than it otherwise would.

**Never render user-supplied text as HTML.** Custom mantra names are free text that
round-trips through an import file. `dangerouslySetInnerHTML` is banned outright:

```js
"react/no-danger": "error",
```

The counter engine already escapes through `esc()` before injecting; keep that path and
do not add a second one.

---

## 7. The import file is untrusted input

`nam-jap-*.json` leaves the browser, can be hand-edited or received from someone else,
and comes back in. The current handler is already careful — it pins every field to the
type in `BLANK` and caps string lengths — and that discipline has to survive the merge
rewrite. A restored file must not be able to introduce a key the renderer has never
seen, a string long enough to fill the library, or a number that breaks the chart.

Cap the number of history entries too: a file with a million day-keys is a denial of
service against the user's own browser.

---

## 8. Push tokens

An FCM token identifies a device. Bind it to the user row, delete it on logout, and
drop it when FCM reports it stale — a token left behind after logout sends someone's
reminders to a device they no longer own. Never accept a token for a `user_id` supplied
in the request body.

---

## 9. Dependencies and the gate

- `npm audit --audit-level=high` runs inside `npm run check`.
- Next.js stays current. Both 2026 CVEs above were patch-level fixes; being three
  minors behind is the actual vulnerability.
- Pin exact versions for anything touching auth or payments.

**The gate.** Nothing above matters if it runs only when someone remembers:

```json
"check": "tsc --noEmit && eslint . && vitest run && npm audit --audit-level=high && next build"
```

Wired to a `pre-push` hook and to CI. A red check blocks the push.

---

## Order of work

Build in this order, because each step's protections are what make the next one safe to
write:

1. `env.server.ts`, the lint rules, the grep, `npm run check`, the pre-push hook
2. Supabase schema — every table with RLS and both policy clauses, plus its isolation test
3. The DAL and `requireUser()`
4. Auth, with a test asserting public signup fails
5. The payment webhook — signature, amount, idempotency
6. Sync, then FCM

Payments and user data come last, when everything that protects them already exists.

---

## Sources

- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase: service role key and RLS](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z)
- [Next.js July 2026 Security Release](https://nextjs.org/blog/july-2026-security-release)
- [Next.js 16.1 security patches, CVEs explained](https://www.pkgpulse.com/guides/nextjs-16-security-patches-cve-2026)
- [Next.js security best practices](https://www.authgear.com/post/nextjs-security-best-practices/)
- [Razorpay: validate and test webhooks](https://razorpay.com/docs/webhooks/validate-test/?preferred-country=US)
- [Guide to Razorpay webhooks](https://hookdeck.com/webhooks/platforms/guide-to-razorpay-webhooks-features-and-best-practices)
