# Tasbih Counts

A free online tasbih and dhikr counter, built on the Bhakti Nam Jap platform: the
same Next.js app, database, accounts, Premium payments, sync, reminders and admin
panel, with the Tasbih Counts counter and content.

The Next.js app is in **`site/`**, not at the repo root. On the host, set the
project's **Root Directory** to `site`; everything else is detected.

```
site/                    the Next.js app — see site/README.md
content/                 page copy, one HTML file per page (node content/build.mjs)
supabase/migrations/     the database, applied with site/scripts/apply-migration.mjs
docs/                    architecture, deploy runbook, admin panel, email templates
```

## How the counter fits in

- `site/src/components/counter/`, `core/`, `stores/`, `content/` — the Tasbih
  counter (React + zustand): dhikr library, targets and rounds, guided routines,
  the 99 Names, Tawaf and Sa'i, auto count, timer.
- `site/src/lib/counter/ledger.ts` — every tap is recorded here, in the same
  storage shape (`njc.hot` / `njc.cold`) and outbox the platform always used, so
  Stats, Streak, backups, account sync and the admin panel work unchanged.
- The admin panel's name library (`public.names`) is the dhikr list; edits reach
  the site within a minute.

## Keys still to replace

`site/.env.local` has the Tasbih Counts Supabase project. These are still the
Bhakti Nam Jap values, as placeholders:

- Google OAuth client (also set in Supabase Auth → Google provider)
- Firebase (web config, VAPID key, service account)
- Razorpay (test keys and webhook secret)
- SMTP sender (Supabase Auth → SMTP; currently contact@bhaktinamjap.com)
- `GOOGLE_TAG_ID` and `ADSENSE_ACCOUNT` in `site/src/lib/site.ts`

## Before the first deploy

```bash
NEXT_PUBLIC_SITE_URL=https://tasbihcounts.com
```

Then follow `docs/DEPLOY.md` (reminders cron, Razorpay webhook URL, Google
redirect URI for the new Supabase project).
