"use server";

import { redirect } from "next/navigation";

import { resolveAdmin } from "@/lib/admin";
import { createCookieClient } from "@/lib/supabase/server";

/**
 * Signing out of the panel.
 *
 * Signing *in* is not here: it is Google, and Google's redirect is started in
 * the browser (components/admin/AdminSignIn.tsx) because Supabase mints the
 * OAuth URL client-side. There is no password form, no one-time code and no
 * "forgot password" — Rajan asked for Google and only Google, and the fewer ways
 * in there are, the fewer there are to get wrong.
 *
 * What still guards the panel after Google has answered is unchanged:
 * requireAdmin() checks the confirmed email against ADMIN_EMAILS on every page
 * and every action. Google says who you are; ADMIN_EMAILS says whether that is
 * anybody here.
 */
export async function signOut(): Promise<void> {
  const supabase = await createCookieClient();
  await supabase.auth.signOut();
  redirect("/admin/login/");
}

/** Used by the sign-in page to send an admin who is already in to the panel. */
export async function alreadyIn(): Promise<boolean> {
  return (await resolveAdmin()).ok;
}
