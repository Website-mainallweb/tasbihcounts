"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js so the installed app opens without a network (#31).
 *
 * Only on a secure origin that is not a local build: a service worker on
 * localhost would keep serving yesterday's development pages, and the test
 * suite blocks workers anyway (playwright.config.ts).
 */
export default function OfflineWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // No offline copy this time; the site works exactly as before.
    });
  }, []);
  return null;
}
