"use client";

import { hasSessionCookie } from "@/lib/counter/sync-client";

/**
 * Whether this browser is signed in, for the counter's own wording ("synced to
 * your account" or "stays on this device").
 *
 * Read from the Supabase session cookie, synchronously, the same way the ledger
 * decides whether to try linking — so the counter never needs a network round
 * trip to know which sentence to show. Sign-in itself lives in AuthHost.
 */
export type Account = { signedIn: true };

export function currentAccount(): Account | null {
  if (typeof document === "undefined") return null;
  try {
    return hasSessionCookie(document.cookie, process.env.NEXT_PUBLIC_SUPABASE_URL) ? { signedIn: true } : null;
  } catch {
    return null;
  }
}
