import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AdminSignIn from "@/components/admin/AdminSignIn";
import { resolveAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The only page in the panel an unauthenticated request may render.
 *
 * It offers one thing. There is no password form to brute-force, no reset link
 * to intercept and no one-time code to phish, because none of those exist here
 * any more — Google is the whole of it.
 *
 * It says nothing about who may get in. A stranger who signs in with Google and
 * is not on the list is sent straight back to this page rather than told they
 * are "not an administrator", which would confirm that the list exists and that
 * they are not on it.
 */
export default async function AdminLoginPage() {
  const state = await resolveAdmin();
  if (state.ok) redirect("/admin/");

  return (
    <div className="signin">
      <div className="signin-card">
        <span className="side-mark" aria-hidden="true">
          ॐ
        </span>
        <p className="eyebrow">Bhakti Nam Jap</p>
        <h1>Admin</h1>
        <p className="lede">Sign in with the Google account that runs this site.</p>

        <AdminSignIn />

        <p className="signin-note">
          Only the account this site is registered to can get in. Anything else sees nothing.
        </p>
      </div>
    </div>
  );
}
