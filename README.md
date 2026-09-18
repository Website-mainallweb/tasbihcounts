# Bhakti Nam Jap

The Bhakti Nam Jap counter, moved off WordPress and rebuilt in Next.js.

The Next.js app is in **`site/`**, not at the repo root. On Vercel, set the
project's **Root Directory** to `site`; everything else is detected.

```
site/                    the Next.js app — see site/README.md
content/                 page copy lifted from WordPress, one file per page
namjapcounterFINAL.html  the counter as delivered, before it was split up
seo-data.json            every Rank Math field read off the live site
site-data.json           menus, media, analytics and PWA settings
```

`content/` is the source of truth for the page copy. Editing it and
regenerating `site/src/content/pages.ts` keeps one copy of the text.

## Before the first deploy

Set the real domain, which every canonical, Open Graph tag, JSON-LD block,
sitemap entry and robots line reads from:

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

## Not in this repo

The WordPress backup (`public_html.zip`) is ignored on purpose. It contains
`wp-config.php` with live database credentials and auth salts, so it must not
be committed. Keep it somewhere private.
