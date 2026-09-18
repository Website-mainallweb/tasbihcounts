import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser's Supabase client, for the sign-in pages only. It holds the anon
 * key, which is public by design and safe only because row-level security is on.
 *
 * Nothing that needs to be trusted is decided here: premium and every data read
 * are checked on the server (lib/dal.ts).
 */

let client: SupabaseClient | undefined;

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Sign-in is not configured on this build");
  return { url, anonKey };
}

/**
 * The session client. It keeps the session — and, for Google, the PKCE verifier —
 * in cookies, so the server callback can finish the exchange and every server
 * page can read who is signed in.
 */
export function browserSupabase(): SupabaseClient {
  const { url, anonKey } = env();
  client ??= createBrowserClient(url, anonKey);
  return client;
}

/*
 * There used to be a second client here, with the implicit flow, for sending the
 * one-time email link. Since 2026-09-12 the site asks for that mail through
 * /api/auth/otp/ instead — a request that leaves the browser cannot be counted,
 * and anyone could otherwise burn the project's hourly mail allowance for
 * everybody. The server asks with the implicit flow, so the link still carries
 * the session in its fragment and works in whichever browser opens it;
 * /auth/confirm/ stores it with the session client above.
 */
