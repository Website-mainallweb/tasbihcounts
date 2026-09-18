import "server-only";

import { createAnonClient } from "@/lib/supabase/server";

/**
 * The kill switches, as the site sees them (docs/ADMIN.md §3.8).
 *
 * Three rules, and the third is the one that matters.
 *
 * **Cached for a minute.** These are read on paths that run per request; a
 * database round trip on each one would make an emergency control into a
 * performance problem. A minute is short enough that turning something off
 * during an incident takes effect while you are still looking at the screen.
 *
 * **Fail open, deliberately.** If Supabase cannot be reached, every switch reads
 * as its normal value rather than as off. A database outage must not also take
 * down payments and sign-in; that turns one failure into four.
 *
 * **The counter is not here, and cannot be.** The database's `key` column is a
 * closed list that does not include it, so there is no flag to read and no
 * screen that could create one. Whatever is switched off, a visitor can still
 * open the site and count.
 */

export type FlagKey =
  | "payments"
  | "google_login"
  | "cloud_sync"
  | "reminders"
  | "ads"
  | "promo_bar"
  | "maintenance_mode";

/** What each switch means when the database cannot be reached. */
const FAIL_OPEN: Record<FlagKey, boolean> = {
  payments: true,
  google_login: true,
  cloud_sync: true,
  reminders: true,
  ads: true,
  promo_bar: true,
  // The odd one out: maintenance is off in normal operation, so failing open
  // means not showing the notice.
  maintenance_mode: false,
};

const TTL_MS = 60_000;

let cache: { at: number; values: Record<string, boolean> } | null = null;
let inFlight: Promise<Record<string, boolean>> | null = null;

async function load(): Promise<Record<string, boolean>> {
  try {
    const { data, error } = await createAnonClient().from("app_flags").select("key, enabled");
    if (error || !data) return { ...FAIL_OPEN };
    const values: Record<string, boolean> = { ...FAIL_OPEN };
    for (const row of data) values[row.key as string] = Boolean(row.enabled);
    return values;
  } catch {
    return { ...FAIL_OPEN };
  }
}

export async function flags(): Promise<Record<string, boolean>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.values;

  // One request refreshes for all of them. Without this, a burst after the cache
  // expires sends a query per request — exactly when the site is busiest.
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null;
    });
  }
  const values = await inFlight;
  cache = { at: Date.now(), values };
  return values;
}

/** Is this system on? */
export async function flagOn(key: FlagKey): Promise<boolean> {
  return (await flags())[key] ?? FAIL_OPEN[key];
}

/** Test seam, and a way for a deploy script to force the next read to be fresh. */
export function clearFlagCache(): void {
  cache = null;
}
