"use client";

import { useEffect } from "react";

import { LOGIN_PATH, loginErrorFrom, safeNext, type LoginError } from "@/lib/auth-redirect";

/* Once per page load. React may run an effect twice in development, and the
   second run would find the fragment already cleared and report a failure. */
let started = false;

/**
 * Finishes an email-link sign-in. The link arrives as
 * `/auth/confirm/?next=/account/#access_token=…&refresh_token=…`: the tokens are
 * handed to the session client, which writes the session cookies the server
 * reads, and the fragment is wiped from the address bar before anything else so
 * it cannot be bookmarked, shared or left in history.
 *
 * The tokens decide nothing by themselves — every server page revalidates them
 * with getUser() (docs/SECURITY.md §3).
 */
export default function EmailLinkConfirm() {
  useEffect(() => {
    if (started) return;
    started = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    history.replaceState(null, "", window.location.pathname + window.location.search);

    const fail = (error: LoginError) => window.location.replace(`${LOGIN_PATH}?error=${error}`);

    const providerError = hash.get("error_description") ?? hash.get("error");
    if (providerError) {
      fail(loginErrorFrom(providerError, hash.get("error_code")));
      return;
    }

    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) {
      fail("failed");
      return;
    }

    // Loaded here, not up front: this page is prerendered, and no prerendered
    // page may carry the Supabase client on first load (scripts/check-bundle.mjs).
    import("@/lib/supabase/browser")
      .then(({ browserSupabase }) =>
        browserSupabase().auth.setSession({ access_token: accessToken, refresh_token: refreshToken }),
      )
      .then(
        ({ error }) => (error ? fail(loginErrorFrom(error.message, error.code)) : window.location.replace(next)),
        () => fail("failed"),
      );
  }, []);

  return null;
}
