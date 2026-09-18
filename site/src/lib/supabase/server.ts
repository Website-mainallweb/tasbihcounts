import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { supabaseEnv } from "@/lib/env.server";

/**
 * Supabase clients that act as the signed-in user, so every query runs under
 * row-level security. Neither ever holds the service role key.
 *
 * Do not call these directly from a route: go through lib/dal.ts, which resolves
 * and verifies the user first.
 */

/** From the session cookie — pages, server actions, same-site routes. */
export async function createCookieClient(): Promise<SupabaseClient> {
  const store = await cookies();
  const { url, anonKey } = supabaseEnv();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // session refresh happens on the next request that can write them.
        }
      },
    },
  });
}

/**
 * No session at all: the anon key as a plain visitor, for the calls that are
 * about someone who is NOT signed in yet — sending a sign-in or reset email.
 * Row-level security still applies to everything it could touch.
 */
export function createAnonClient(): SupabaseClient {
  const { url, anonKey } = supabaseEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * From a bearer token — the sync endpoint (ARCHITECTURE M2): `fetch` with
 * `keepalive` can carry an Authorization header, which a cross-site page cannot
 * forge, so the endpoint does not depend on cookies at all.
 */
export function createTokenClient(token: string): SupabaseClient {
  const { url, anonKey } = supabaseEnv();
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
