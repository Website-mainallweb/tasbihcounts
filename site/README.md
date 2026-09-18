# Tasbih Counts — Next.js

Next.js 16 (App Router, TypeScript). The public pages are prerendered and the
counter keeps its state in the visitor's own browser; Supabase holds Premium
accounts, synced practice, payments and the admin panel's data.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm run start
```

## Before going live

Set the real domain. Everything that prints a URL (canonical tags, Open Graph,
JSON-LD, sitemap, robots, the Contact page's Website line) reads this one value:

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

Without it the build falls back to `https://bhaktinamjap.com`.

## What was carried over

Copy, headings, bold and italic runs, internal links and the closing emoji are
byte-identical to the WordPress pages. So are the Rank Math titles, meta
descriptions, robots directives, canonicals, Open Graph and Twitter tags, the
schema graph and the five sitemap URLs. Slugs are unchanged and trailing
slashes are preserved, so no redirects are needed.

The old site's `robots.txt` carried `User-agent: Googlebot / Disallow: /`, a
Hostinger default for temp domains that blocked Google entirely. The generated
`robots.txt` allows crawling.

The root files the old site served are here too: `public/ads.txt` carries the
same AdSense line, and the social card and schema logo are still served from
their original `/wp-content/uploads/2025/10/` URLs so every value in the head
is unchanged.

Two tags the old head carried are deliberately absent:
`google-adsense-platform-account` and `google-adsense-platform-domain`. Those
are Site Kit's host-platform attribution and would claim this site is hosted on
`sitekit.withgoogle.com`. `google-adsense-account` with the publisher id from
ads.txt is there instead. Say the word if you want the originals back.

## Verifying

All three scripts run against a server that is already up.

```bash
node scripts/verify-seo.mjs http://localhost:3000
node scripts/verify-content.mjs http://localhost:3000 https://the-old-site
node scripts/compare-head.mjs http://localhost:3000 https://the-old-site
```

`verify-seo` asserts 98 head and structured-data facts. `verify-content`
fetches the old WordPress pages and the new ones and compares them word for
word, printing the first divergence. `compare-head` diffs every meta tag,
canonical and schema field between the two sites and lists anything missing,
changed or added.

## Layout

```
src/app/          routes, globals.css (site shell), counter.css (widget)
src/components/   counter markup + engine, header, footer, brand mark
src/content/      generated page copy, do not hand-edit
src/lib/          site constants and the SEO builders
scripts/          the two verifiers
../content/       source HTML for the page copy
```

To change page copy, edit the HTML in `../content` and regenerate
`src/content/pages.ts`, so the copy has one source of truth.

## The counter

The counter is the Tasbih Counts app's own: React components in
`src/components/counter/`, the counting rules in `src/core/`, its state in
`src/stores/` (zustand, with IndexedDB for per-dhikr snapshots and sessions),
and the dhikr, routines, rites and 99 Names in `src/content/`.
`src/components/TasbihCounter.tsx` mounts it inside a `.tc` wrapper.

**The record lives in the ledger.** `src/lib/counter/ledger.ts` is the data half
of the old Nam Jap engine with the DOM taken out. Every tap the counter makes is
reported to it as "n counts and r completed rounds, for this dhikr", and it keeps
the same `njc.hot` / `njc.cold` storage, the per-day, per-dhikr history, the
outbox and the sync client as before. Stats, Streak, backups, the account link,
Premium sync and the admin panel read that record, so none of them changed. A
round — what a streak day is made of — is a completed target, round or routine
step, and with no target at all, every 33.

**Styles.** `src/app/counter.css` is the counter's stylesheet with Tailwind's
theme and utilities (no preflight), generated only from the counter's own files.
Its base styles are scoped under `.tc`, and its tokens (`--bg`, `--accent`…)
are the site's tokens, so the theme chosen in the counter (light, dark, noor,
heritage) re-skins the whole page. The shell's element defaults sit in a low
cascade layer (`globals.css`) so they never override a utility.

## The header

The bar hides on the way down and comes back on the way up, past 90px of
scroll, with a 6px deadzone so it does not flicker. It stays put while the
mobile drawer is open. The scroll handler does its work inline rather than
inside `requestAnimationFrame`: rAF is paused whenever the page is not being
composited, which would leave the bar stuck where it was.
