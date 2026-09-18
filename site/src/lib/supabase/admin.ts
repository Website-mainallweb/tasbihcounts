import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdminEnv } from "@/lib/env.server";

/**
 * The service role client. It bypasses row-level security entirely.
 *
 * It belongs in exactly two kinds of place (docs/SECURITY.md §2): the Razorpay
 * webhook, which has no user session, and scheduled jobs. eslint refuses the
 * import anywhere else. When a query fails under RLS, the policy is what is
 * wrong — reaching for this client hides the bug and hands over the database.
 */
export function createAdminClient(): SupabaseClient {
  const { url, serviceRoleKey } = supabaseAdminEnv();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
