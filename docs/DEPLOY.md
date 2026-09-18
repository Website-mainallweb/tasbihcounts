# Deploy and launch runbook

Everything that has to be done outside the code for the Premium plan to work in
production, in the order it should happen. Items marked **Rajan** need his account,
money, or a decision; everything else can be done from this repository.

Written 2026-09-10 while Phases 8–11 were being built. Keep it current.

---

## 1. Server environment (Hostinger → Environment variables)

The site already runs `next start` on Hostinger. These must be set there, exactly as in
`site/.env.local` — never committed, never in a `NEXT_PUBLIC_` name unless listed as
public below.

| Variable | Public? | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | every Supabase client; the CSP `connect-src` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes (safe only because RLS is on) | sign-in, the DAL |
| `SUPABASE_SERVICE_ROLE_KEY` | **no** | the payment webhook and the reminder scheduler only |
| `RAZORPAY_KEY_ID` | no (sent to Checkout at order time) | orders |
| `RAZORPAY_KEY_SECRET` | **no** | orders, checkout signature |
| `RAZORPAY_WEBHOOK_SECRET` | **no** | webhook signature |
| `NEXT_PUBLIC_FIREBASE_*` (6 values + `VAPID_KEY`) | yes | reminders in the browser |
| `FIREBASE_SERVICE_ACCOUNT` | **no** | sending reminders (one line of base64 JSON) |
| `CRON_SECRET` | **no** | the reminder scheduler's credential; ≥ 32 random characters |
| `ADMIN_EMAILS` | no | who may open the admin panel (comma-separated, confirmed emails); unset means nobody |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | stored in Supabase Auth, not read by the site |
| `NEXT_PUBLIC_EMAIL_CODE` | yes (a flag, not a secret) | set to `1` to show the "type the code" box on `/login/`. It needs custom SMTP on the Supabase project — without it the free plan refuses template edits, so the mail carries no code and the box would ask for something that never arrives. |

`SUPABASE_DB_PASSWORD` and `SUPABASE_ACCESS_TOKEN` are for the CLI and the Management
API from a developer machine. **Do not set them on the server.**

A missing or truncated server key fails the first request that needs it, loudly, and
names the variable (`src/lib/env.server.ts`).

**The `NEXT_PUBLIC_*` values must be set for the BUILD, not only for `next start`.**
Next inlines them into the browser bundle while it builds, and Hostinger's Git build is a
separate step from the running app. A build with none of them set still succeeds and
still looks green — that was verified on a clean `npm ci` of this tree — but the browser
then receives nothing, `browserSupabase()` throws "Sign-in is not configured on this
build", and sync never starts. Nothing on the server catches this, because the server
has its own copy of the variables.

After every deploy, before anything else: open `/login/`, sign in, and confirm `/account/`
shows the email. That single check proves the public values reached the bundle. (On a
shell, the same thing: the built chunks under `.next/static/chunks/` should contain the
Supabase project URL as literal text, not the string `NEXT_PUBLIC_SUPABASE_URL`.)

## 2. Database migrations

`supabase link` is refused for this project's access token (it lacks the project-status
privilege), so migrations are applied through the Management API:

1. Check the target is in the state the migration expects (read-only SQL).
2. Send the migration wrapped in `begin; … commit;`, with a guard that aborts if it has
   already been applied.
3. Insert its row into `supabase_migrations.schema_migrations (version, statements, name)`
   in the same transaction, so a later `supabase db push` does not run it again.
4. Run `npm run verify:rls:remote` — two temporary users, the isolation matrix, full
   cleanup.

Applied so far: `20260910120000_phase7_schema`. Later migrations in
`supabase/migrations/` are applied the same way when their phase ships.

Three migrations belong to the admin panel (§8 below). They were applied on
2026-09-15, in this order:

```text
20260915120000_admin_audit.sql     the append-only audit log
20260915130000_admin_support.sql   dashboard/user functions, kill switches, names table
20260915140000_names_seed.sql      the 45 names, copied from site/src/lib/counter/names.ts
```

Had they not been, the panel would show only its sign-in and the site would fall
back to the bundled name list and treat every kill switch as on. Both are the
designed fallbacks rather than failures, and they are what makes the site survive
Supabase being unreachable — worth keeping in mind when reading §3.9 of
docs/ADMIN.md.

All three are tested against a real Postgres before they go near the project:
`npm run test` in `site` runs them in PGlite (tests/unit/db/admin.test.ts).

## 3. Supabase Auth

Set through the Management API (`PATCH /v1/projects/{ref}/config/auth`) and checked by
`npm run verify:auth:remote`:

- Signups **disabled**. Accounts are created only by a completed payment.
- Google provider on, with the OAuth client id and secret.
- Site URL = the production site; redirect allow-list = the production site, and
  `localhost:3000`, `localhost:3100`, `127.0.0.1:3100` for testing.

**Rajan — custom SMTP.** Supabase's built-in mailer only sends to project team members,
about two emails an hour. Real buyers will not receive sign-in links until a provider is
configured (Resend, Brevo, or similar, with the site's domain verified in DNS). Once it
is, the sign-in email template can be changed as well — the free tier refuses template
edits without custom SMTP.

## 4. Google sign-in

- OAuth client "Tasbih Counts Web" has the Supabase callback
  `https://<project ref>.supabase.co/auth/v1/callback` as an authorised redirect URI.
- The consent screen is in **Testing**: only listed test users can sign in with Google
  (japnamecontact@gmail.com is listed).
- **Rajan — before launch:** complete Google Auth Platform → Branding (app name, support
  email, home page, privacy policy and terms links on the site's domain, authorised
  domains including the site's and `supabase.co`), then Audience → **Publish app**. The
  scopes are only email and profile, so no Google verification review is needed.

## 5. Razorpay

- **Webhook** (Razorpay Dashboard → Settings → Webhooks): URL
  `https://<site>/api/razorpay/webhook/`, the webhook secret = `RAZORPAY_WEBHOOK_SECRET`,
  events `payment.authorized`, `payment.captured`, `order.paid`, `refund.processed`,
  `payment.refunded`.
- Test mode first. The purchase flow is tested **only by Rajan, in his own Chrome**.
- **Rajan — going live:** complete KYC (the Terms, Refund & Cancellation, Privacy and
  Contact pages are live for the review), generate live keys, then in one change:
  - swap `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` **and** `RAZORPAY_WEBHOOK_SECRET`
    (a live webhook with the test secret silently refuses every real payment);
  - `update private.app_config set payment_mode = 'live';` — test-mode entitlements stop
    counting at that moment (ARCHITECTURE M6);
  - make one real ₹200 purchase and one real sign-in (the Ship 3 gate).

## 6. Reminders scheduler

Supabase runs it: `pg_cron` calls the site every 15 minutes through `pg_net`, with the
secret kept in Vault. Run once, after the site with `/api/cron/reminders/` is deployed:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<CRON_SECRET value>', 'cron_secret');

select cron.schedule(
  'bnj-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<site>/api/cron/reminders/',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $$
);
```

To stop it: `select cron.unschedule('bnj-reminders');`. Locally, call the route with the
header by hand — Supabase cannot reach `localhost`.

## 7. Before launch (Ship 5, Phase 12)

- **Rajan — Supabase Pro.** Free projects pause when idle and have no downloadable
  backups; for a product that promises "your count is safe", Pro is a launch requirement.
- Backups configured **and one restore actually performed** into a scratch project.
- Rotate what was pasted into chat: the Supabase service role key and the `sbp_` access
  token (revoke it once migrations are done). Consider moving to `sb_publishable_` /
  `sb_secret_` keys at the same time (ARCHITECTURE M1).
- Two-device sync verified on real hardware (Rajan's phone and laptop).
- After the first deploy: signed in on the live site once, to prove the `NEXT_PUBLIC_*`
  values were present when Hostinger built it (§1) — a green build does not prove it.
- `npm run restore:drill` passes against the live project (export → rebuild from migrations → counts and per-user totals match); delete `site/.restore-drill/` afterwards.
- `npm run check` includes `npm run bundle`: first-load JS per page within budget and no Supabase, Firebase or Razorpay code on first load.

---

## 7b. Operational scripts added with the admin panel

All run from `site/`, all read `site/.env.local`, none print a key:

| Script | What it does |
|---|---|
| `node scripts/apply-migration.mjs --check` | which migrations the project has, and which are pending |
| `node scripts/apply-migration.mjs <version>` | applies one, in a transaction, and records it |
| `node scripts/verify-admin-remote.mjs` | the admin tables checked on the live project: who may read the names and switches, who may not write them, that a name cannot be deleted or renamed, that no counter switch can exist, that the audit log cannot be rewritten |
| `node scripts/flip-flag.mjs <key> <on|off>` | throws a kill switch without the panel (the panel is the way to do it in earnest — it records who and why) |
| `node scripts/name-toggle.mjs <id> <show\|hide>` | publishes or hides one name, same caveat |
| `node scripts/probe-admin.mjs` | runs every read the panel does against the real project and prints what each screen would show; read-only |

---

## 8. The admin panel (admin.tasbihcounts.com)

**One application.** The panel is part of the site's Next app, served on a
subdomain — not a second deployment. There is no second build, no second root
directory and no second set of environment variables. `src/proxy.ts` rewrites
requests whose host starts with `admin.` onto the `/admin` routes, and answers
`/admin` on the main domain with a 404.

**Rajan — in hPanel:** add the subdomain `admin`, and point it at the **same**
Node.js website the main domain already uses. If hPanel insists on creating a
separate site for it, the DNS record simply has to resolve to the same
application; nothing else about the deployment changes.

Nothing new to set in the environment. The panel uses `ADMIN_EMAILS`, which is
already there, and nothing else.

### Migrations

Applied 2026-09-15 (§2), verified with `npm run verify:rls:remote` (20/20) and
`node scripts/verify-admin-remote.mjs` (13/13).

### First sign-in

1. Open `https://admin.tasbihcounts.com/` and press **Continue with Google**.
2. Sign in with the account whose address is in `ADMIN_EMAILS`. Any other Google
   account gets a 404 — the panel does not say why, on purpose.
3. **Turn on 2-Step Verification on that Google account.** It is the panel's
   second factor and nothing in this code can check that it is on.

There is no password and no reset link in the panel. If Google sign-in ever stops
working, the way back in is Google's own account recovery, not this application.

### Google OAuth

The consent screen's authorised redirect URI is Supabase's callback, which does
not change. What does need checking once, before the first sign-in: the
**Site URL and redirect allow-list** in Supabase Auth (§3) must include
`https://admin.tasbihcounts.com/**`, or Google will return the operator to the
main domain and the panel will never see the session.
