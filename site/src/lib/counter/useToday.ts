"use client";

import { useSyncExternalStore } from "react";

import { dayKey } from "./day";

/**
 * Today's day key, known only in the browser.
 *
 * Streak and Stats are prerendered at build time. A `dayKey()` called during
 * render baked the BUILD day into their HTML; the browser then rendered its own
 * day, React threw hydration error #418 on the Streak page, and on Stats — where
 * only attributes differed — it kept the build day marked as "today". The server
 * snapshot is null, so the first client render matches the HTML and the real day
 * arrives on the render after.
 *
 * It also moves past midnight: re-read every minute and when the tab comes back.
 */
function subscribe(onChange: () => void): () => void {
  const id = window.setInterval(onChange, 60_000);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onChange);
  };
}

export function useToday(): string | null {
  return useSyncExternalStore(subscribe, () => dayKey(), () => null);
}
