"use client";

/**
 * The quiet status line above the counter.
 *
 * Three things could go wrong without the reader ever being told, and all three
 * are things a person would want to know:
 *
 *   OFFLINE        counting still works — that is the whole design — but
 *                  nothing is syncing, and somebody who signed in precisely so
 *                  their practice would follow them deserves to know it is not
 *                  following them right now.
 *
 *   STORAGE BLOCKED  a database upgrade is stuck behind another tab. Until it
 *                  clears, nothing is being saved. Silence here means losing a
 *                  sitting.
 *
 *   DEEP LINK MISS  a URL named a dhikr or routine that does not exist. The
 *                  counter used to open on the default in silence, so the
 *                  reader counted the wrong thing believing the link worked.
 *
 * It is deliberately a thin line, not a dialog: none of these should interrupt
 * counting, and two of them resolve themselves.
 */

import { useEffect, useState } from "react";
import { onStorageBlocked } from "@/lib/storage";
import { onDeepLinkMiss } from "@/lib/deep-link";
import { currentAccount } from "@/lib/auth";

export function StatusBar() {
  const [offline, setOffline] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [miss, setMiss] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(currentAccount() !== null);
    setOffline(!navigator.onLine);

    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    const unsubscribe = onStorageBlocked(() => setBlocked(true));

    // Subscribe rather than poll. The miss is recorded only after the counter
    // has hydrated, which on a cold load is well past any timeout worth using.
    const stopWatchingLink = onDeepLinkMiss(setMiss);

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      unsubscribe();
      stopWatchingLink();
    };
  }, []);

  if (blocked) {
    return (
      <Line tone="warn" role="alert">
        This app is open in another tab that needs to close before anything can
        be saved here. Close the other tab, then reload this one.
      </Line>
    );
  }

  if (miss) {
    return (
      <Line tone="warn" onDismiss={() => setMiss(null)}>
        Nothing here is called &ldquo;{miss}&rdquo;, so the counter opened on
        your usual dhikr. Choose one above to change it.
      </Line>
    );
  }

  // Offline is only worth saying to somebody who expects syncing. A guest is
  // offline by design and telling them so would be noise.
  if (offline && signedIn) {
    return (
      <Line tone="quiet">
        Offline. Counting works exactly as normal, and everything syncs by itself
        when you are back.
      </Line>
    );
  }

  return null;
}

function Line({
  children,
  tone,
  role,
  onDismiss,
}: {
  children: React.ReactNode;
  tone: "warn" | "quiet";
  role?: "alert";
  onDismiss?: () => void;
}) {
  return (
    <div
      role={role ?? "status"}
      className={`mt-2 flex items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-[12.5px] leading-relaxed ${
        tone === "warn"
          ? "border-warm bg-warm-soft text-warm"
          : "border-border bg-surface-sunken text-fg-muted"
      }`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 px-1 text-current opacity-70 hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
