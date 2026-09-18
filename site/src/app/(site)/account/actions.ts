"use server";

import { redirect } from "next/navigation";

import { LOGIN_PATH } from "@/lib/auth-redirect";
import { requireUser, Unauthorized } from "@/lib/dal";

/**
 * Signs the current device out. A server action is a public POST endpoint, so it
 * resolves the user itself like every other handler (SECURITY §3).
 */
export async function signOut() {
  try {
    const { supabase } = await requireUser();
    await supabase.auth.signOut({ scope: "local" });
  } catch (err) {
    if (!(err instanceof Unauthorized)) throw err;
    redirect(LOGIN_PATH);
  }
  redirect("/");
}
