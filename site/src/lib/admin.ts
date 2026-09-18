import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { requireUser, Unauthorized, type Authed } from "@/lib/dal";
import { adminEnv } from "@/lib/env.server";

/**
 * Who may use the admin panel (docs/ADMIN.md §2).
 *
 * Two checks, and the second can only narrow the first:
 *
 *   1. a real session, verified with the auth server, whose email is confirmed;
 *   2. that email being in ADMIN_EMAILS.
 *
 * (1) verifies through requireUser(), which calls getUser() — never
 * getSession(), which trusts whatever the cookie says and passes a forged one
 * (docs/SECURITY.md §3).
 *
 * There was an optional IP allowlist here and it has been removed. It could not
 * work: behind a proxy the only address we may trust is the LAST hop of
 * x-forwarded-for, and behind Hostinger that is the proxy's own address, never
 * the operator's. Setting it would have matched nothing and locked the one
 * person who could fix it out of the panel permanently. Taking the client's
 * claimed address instead would have made it forgeable with one header — an
 * access control that is not one is worse than none, because it gets believed.
 *
 * Sign-in is Google and nothing else (components/admin/AdminSignIn.tsx). There
 * is no password to guess here and no reset mail to intercept; the second factor
 * is whatever 2-Step Verification the Google account itself has, which is worth
 * turning on and is not something this code can enforce.
 *
 * Every admin page and every admin server action calls requireAdmin() itself.
 * Middleware is not a boundary — two 2026 CVEs let requests skip it — and
 * scripts/check-admin-guards.mjs fails the build on any that does not.
 */

export type Admin = { user: User; supabase: SupabaseClient; email: string };

type Resolution =
  | { ok: true; admin: Admin }
  /** No session, or one the auth server would not confirm. */
  | { ok: false; reason: "anonymous" }
  /** A real account, but not one of ours. Indistinguishable from "no such page". */
  | { ok: false; reason: "forbidden" };

/**
 * Is this address one of ours?
 *
 * A named function rather than the list comparison written out at each call
 * site, because "on the list" has two parts — lower-cased and present — and two
 * copies of that rule is one copy too many.
 */
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return adminEnv().emails.includes(email.toLowerCase());
}

/**
 * The raw answer, memoised per request. The sign-in page uses this, because it
 * needs to tell the cases apart instead of being redirected by them.
 */
export const resolveAdmin = cache(async (): Promise<Resolution> => {
  let authed: Authed;
  try {
    authed = await requireUser();
  } catch (err) {
    if (err instanceof Unauthorized) return { ok: false, reason: "anonymous" };
    throw err;
  }

  const email = authed.user.email?.toLowerCase();
  if (!email || !authed.user.email_confirmed_at) return { ok: false, reason: "forbidden" };
  if (!isAdminEmail(email)) return { ok: false, reason: "forbidden" };

  return { ok: true, admin: { user: authed.user, supabase: authed.supabase, email } };
});

/**
 * The guard every admin page and action uses.
 *
 * Signed out goes to the panel's own sign-in. Everything else — a buyer's
 * account, a typo in ADMIN_EMAILS, a blocked address — gets a plain 404, so the
 * panel never confirms to a stranger that it exists or who could open it.
 */
export async function requireAdmin(): Promise<Admin> {
  const result = await resolveAdmin();
  if (result.ok) return result.admin;
  if (result.reason === "anonymous") redirect("/admin/login/");
  notFound();
}
