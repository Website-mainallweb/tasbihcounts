"use client";

import { useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * The browsers built into WhatsApp, Instagram, Facebook and similar apps (#43).
 *
 * Most visitors arrive from a link shared in a chat, and those browsers are a
 * poor home for a practice: Google refuses sign-in inside them
 * ("disallowed_useragent"), downloads usually do nothing, and their storage can
 * be cleared when the app closes. Nothing here blocks the page — it only says so,
 * once, until dismissed.
 */
export function isInAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|Twitter|LinkedInApp|GSA\/|; wv\)/i.test(ua);
}

const KEY = "njc.inapp-dismissed";

function shouldShow(): boolean {
  try {
    if (sessionStorage.getItem(KEY)) return false;
  } catch {
    // No session storage in some of these browsers: show it, it is dismissible.
  }
  return isInAppBrowser(navigator.userAgent || "");
}

export default function InAppBrowserNotice() {
  const detected = useSyncExternalStore(noSubscribe, shouldShow, () => false);
  const [dismissed, setDismissed] = useState(false);
  if (!detected || dismissed) return null;

  return (
    <div className="inapp-notice" role="status">
      <p>
        You are in an app&apos;s built-in browser. To keep your jap safe, log in and download backups,
        open this page in <strong>Chrome</strong> or <strong>Safari</strong> — use the ⋮ or share menu, then
        &ldquo;Open in browser&rdquo;.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try {
            sessionStorage.setItem(KEY, "1");
          } catch {}
          setDismissed(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}
