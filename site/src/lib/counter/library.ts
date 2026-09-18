import "server-only";

import { NAMES, type NameEntry } from "@/lib/counter/names";
import { createAnonClient } from "@/lib/supabase/server";

/**
 * The name library, read from the database (docs/ADMIN.md §3.9).
 *
 * The admin panel edits `public.names`; this is how an edit reaches a visitor.
 * The page that renders the counter is regenerated at most once a minute, so a
 * change is live within the minute and without a deploy — and the page stays a
 * static file, which is what keeps the counter fast and the ad review happy.
 *
 * **It falls back to the bundled list and never throws.** Supabase being slow,
 * paused, or misconfigured must not take the counter down: the names in
 * names.ts are the same names, and a visitor whose database call failed gets a
 * working counter with a slightly old library rather than a broken page. That is
 * the same promise the kill switches make — optional systems may fail, the
 * counter does not.
 *
 * The table is readable by `anon` (its RLS policy allows published rows), so
 * this uses the ordinary anon client. No service role reaches the public site.
 */
export async function libraryNames(): Promise<NameEntry[]> {
  try {
    const { data, error } = await createAnonClient()
      .from("names")
      .select("id, devanagari, transliteration, meaning, grp")
      .eq("published", true)
      .order("position", { ascending: true });

    if (error || !data || data.length === 0) return NAMES;

    return data.map((row) => ({
      id: row.id as string,
      n: row.devanagari as string,
      t: row.transliteration as string,
      m: row.meaning as string,
      ...(row.grp === "mantra" ? { g: "mantra" as const } : {}),
    }));
  } catch {
    // Includes the case where Supabase is not configured on this build at all,
    // which is exactly when a preview or a local run must still work.
    return NAMES;
  }
}

/**
 * The library as a script the browser runs before the engine starts.
 *
 * Inlined into the page rather than fetched: a fetch would mean the counter
 * booting with one list and swapping to another a moment later, which a person
 * mid-practice would see as their selected name jumping. It is about 3 KB of
 * HTML and no extra JavaScript beyond the six-line read in names.ts.
 *
 * JSON.stringify is the escaping, plus the one thing it does not handle — a
 * literal `</script>` inside a string would close this tag early. No name
 * contains one; the replacement is here so that stays true.
 */
export function libraryBootstrap(names: NameEntry[]): string {
  const json = JSON.stringify(names).replace(/</g, "\\u003c");
  return `window.__njcNames=${json};`;
}
