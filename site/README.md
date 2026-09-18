# Bhakti Nam Jap — Next.js

The WordPress site rebuilt in Next.js 16 (App Router, TypeScript). Every page
is statically prerendered. There is no database and no backend: the counter
keeps its state in the visitor's own browser.

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

`namjapcounterFINAL.html` was split into three pieces: its stylesheet became
`src/app/counter.css`, its markup became a string in
`src/components/counter-markup.ts`, and its engine became
`src/components/counter-engine.js` with the IIFE wrapper swapped for a named
export. `NamJapCounter.tsx` mounts the markup and starts the engine once.

Changes made to the engine, each for a reported bug:

- **Scroll jump.** The ring was sized from `window.innerHeight`. On a phone the
  URL bar slides away as you scroll, `innerHeight` changes by 60-120px, the
  ring resized and the page reflowed under the finger. Viewport-driven resizes
  now go through a guard that ignores height-only changes under 140px, and the
  ResizeObserver reacts to width only, so it cannot chase its own output.
- **Full screen with no name control.** Everything marked `njc-hide` was hidden
  in immersive mode, including the select bar, which is the only way to change
  the name. The rails, top bar, header stats and mode chips still step aside;
  the select bar stays. The layout is now a column: name on top, ring in the
  space that is left, control rail on the floor.
- **Full-screen fallback.** `requestFullscreen` rejections are caught, and
  iPhone Safari has no element fullscreen at all, so the counter pins itself
  over the page instead (`.njc-faux-fs`) with the page chrome hidden. Escape
  leaves it.
- **Sheet under the header.** `.njc` sets `isolation:isolate`, so the sheets
  could not escape the counter's stacking context and the sticky header painted
  over the open modal. The engine now flags `njc-sheet-open` on `<html>` and the
  page lifts the widget while a sheet is up.
- **Scroll position lost on closing a sheet.** The position was captured and
  never restored. Chrome survives the `overflow:hidden` lock, iOS Safari does
  not and drops the reader to the top.
- **Wide-layout spacing.** A 320px ring floated in a 620px column. The ring may
  now take 58% of the viewport height on tablet and desktop, the caps went up,
  and the shell and page title lost padding they did not need. From 768px up
  the widget is full bleed, with fractional rails so the three columns grow
  with the page instead of leaving margins down both sides.
- **No name chosen.** The counter used to start on Ram, a name nobody picked.
  A new visitor now sees "Select a name", the ring and select bar read as a
  prompt, and the first tap opens the picker instead of counting. Once a name
  is chosen everything behaves as before.
- **Two rows of chrome.** The widget's own brand row duplicated the site
  header, so it is hidden on the page and its language and theme buttons are
  proxied from the header. It comes back in full screen, wordmark dropped,
  because the site header is gone there.

The counter owns the page's theme. It writes `data-theme` on `#njc`, a
`MutationObserver` mirrors that onto `<html>`, and a small inline script in the
layout reads the stored theme before first paint so a dark theme does not
flash white.

Nothing in `globals.css` transitions a colour. Chromium leaves a transitioned
colour stuck at its old value when the change arrives through an inherited
custom property, which left the page background on the previous theme.

`main` carries `position: relative` and no `z-index`. Adding one makes it a
stacking context and caps everything inside it, including the counter's sheets,
below the sticky header. The article's halo uses `z-index: -1` instead.

## The header

The bar hides on the way down and comes back on the way up, past 90px of
scroll, with a 6px deadzone so it does not flicker. It stays put while the
mobile drawer is open. The scroll handler does its work inline rather than
inside `requestAnimationFrame`: rAF is paused whenever the page is not being
composited, which would leave the bar stuck where it was.
