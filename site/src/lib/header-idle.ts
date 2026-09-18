"use client";

import { PREMIUM_CHECKED_KEY, writePremiumFlag } from "./premium-flag";
import { applyTheme } from "./theme-color";

/**
 * Ask the server once per browser session whether the signed-in account holds
 * Premium, and record it. Called by the header whenever a session cookie exists,
 * so a sign-in from the popup — which stays on the current page — is picked up
 * without visiting /account/.
 */
async function refreshPremiumFlag(): Promise<"ok" | "signed-out" | "unknown"> {
  try {
    if (sessionStorage.getItem(PREMIUM_CHECKED_KEY)) return "ok";
  } catch {}
  try {
    const res = await fetch("/api/account/premium/", { credentials: "same-origin", cache: "no-store" });
    /* B52: the cookie is there but the server no longer accepts it (expired
       refresh token, signed out elsewhere). The header stops claiming an account. */
    if (res.status === 401) {
      writePremiumFlag(false);
      return "signed-out";
    }
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { premium?: boolean };
    writePremiumFlag(data.premium === true);
    try {
      sessionStorage.setItem(PREMIUM_CHECKED_KEY, "1");
    } catch {}
    return "ok";
  } catch {
    // Offline: keep whatever this browser last knew.
    return "unknown";
  }
}

/**
 * The header's background work, fetched once the page is idle so none of it
 * weighs on the counter's first load (the "/" budget in check-bundle.mjs).
 *
 *  - B01/B52: ask the server once per browser session whether the account holds
 *    Premium; a cookie the server refuses means signed out.
 *  - B50/B54: a theme chosen on the counter in another tab reaches this page,
 *    and the browser bar colour follows the theme.
 */
export function startHeaderIdle(hasCookie: boolean, onSignedOut: () => void): () => void {
  if (hasCookie) {
    void refreshPremiumFlag().then((r) => {
      if (r === "signed-out") onSignedOut();
    });
  }

  const current = document.documentElement.getAttribute("data-theme");
  if (current && !document.getElementById("njc")) applyTheme(current);
  const onStorage = (e: StorageEvent) => {
    // The counter page follows its own widget.
    if ((e.key !== "njc.cold" && e.key !== "njc.v1") || document.getElementById("njc")) return;
    try {
      const parsed = JSON.parse(e.newValue || "null");
      const theme = parsed?.state?.theme ?? parsed?.theme;
      if (typeof theme === "string") applyTheme(theme);
    } catch {}
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
