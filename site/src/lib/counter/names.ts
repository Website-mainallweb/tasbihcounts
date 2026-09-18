/**
 * The dhikr library as the pages that read the practice history see it: an id,
 * the Arabic, the transliteration and the meaning. Stats uses it to show a name
 * instead of an id.
 *
 * The full entries — targets, sources, aliases — are in content/dhikr.ts, which
 * the counter reads. This is the same list in the shape public.names stores, so
 * lib/counter/library.ts can fall back to it when the database cannot be reached.
 * Ids never change: a practice's history is stored under them.
 */

import { DHIKR, getDhikr } from "@/content/dhikr";

/** n: the Arabic, t: the transliteration, m: the meaning, g: "mantra" for the longer adhkar. */
export type NameEntry = { id: string; n: string; t: string; m: string; g?: "mantra" };

const LONG = new Set(["durood", "recitation", "morning-evening", "hajj"]);

/** The bundled library, in the order the counter shows it. */
export const NAMES: NameEntry[] = DHIKR.map((d) => ({
  id: d.id,
  n: d.arabic,
  t: d.transliteration,
  m: d.meaning,
  ...(LONG.has(d.category) ? { g: "mantra" as const } : {}),
}));

/**
 * The list this page is actually using: the database's copy when the page
 * inlined one as `window.__njcNames`, the bundled list otherwise. Checked rather
 * than trusted, so anything malformed falls back instead of breaking a page.
 */
export function library(): NameEntry[] {
  const injected = (globalThis as { __njcNames?: NameEntry[] }).__njcNames;
  return Array.isArray(injected) && typeof injected[0]?.id === "string" ? injected : NAMES;
}

/**
 * What a person calls a dhikr: their own words for one they added, the library
 * title for a built-in one — a single Name of Allah, a rite and a phrase alike —
 * and never the raw id. A custom id with no text on this device (it was added on
 * another one) reads as "Your own dhikr".
 */
export function nameLabel(id: string, custom: unknown, lang: "en" | "hi" = "en"): string {
  void lang;
  const own = Array.isArray(custom) ? (custom as Partial<NameEntry>[]).find((c) => c && c.id === id) : undefined;
  if (own) {
    const text = own.t || own.n;
    if (typeof text === "string" && text.trim()) return text;
  }
  const known = library().find((x) => x.id === id);
  if (known) return known.t;
  const d = getDhikr(id);
  if (d) return d.name;
  if (/^(custom-|c\d+$)/.test(id)) return "Your own dhikr";
  return id;
}
