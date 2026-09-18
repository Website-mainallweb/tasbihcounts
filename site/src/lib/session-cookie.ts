/* Kept apart from sync-client so a page can ask whether it is signed in without
   downloading the sync code. */

/**
 * Whether this browser holds a Supabase session at all, without loading the
 * Supabase client: the cookie `sb-<project ref>-auth-token` (or its chunks).
 */
export function hasSessionCookie(cookie: string, supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  try {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    return new RegExp(`(?:^|;\\s*)sb-${ref}-auth-token(?:\\.\\d+)?=`).test(cookie);
  } catch {
    return false;
  }
}
