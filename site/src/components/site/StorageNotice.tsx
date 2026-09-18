"use client";

/**
 * The durability warning.
 *
 * WHY THIS IS NOT OPTIONAL
 * The product's central promise is "count for years, no account needed". That
 * promise is only true while the browser keeps the data, and by default it
 * makes no such commitment:
 *
 *   Safari   deletes ALL script-writable storage after seven days without a
 *            visit, unless the site is on the home screen
 *   Chrome   evicts under storage pressure unless persistence is granted
 *   Firefox  the same, and it prompts rather than granting silently
 *
 * `requestPersistentStorage()` asks for the commitment. When the answer is no,
 * the reader is entitled to know, in plain words, before they lose a year of
 * practice — and to be told the two things that actually fix it.
 *
 * It appears only when persistence was REFUSED and the reader has enough
 * history to lose. Nagging somebody on their first tap would be noise; telling
 * somebody with a 40-day streak that their data is not safe is a service.
 */

import { useEffect, useState } from "react";
import {
  requestPersistentStorage,
  storageEstimate,
  type PersistState,
} from "@/lib/storage";
import { useCounter } from "@/stores/counter-store";
import { currentAccount } from "@/lib/auth";
import { isIOS } from "@/lib/feedback";

export function StorageNotice({ compact }: { compact?: boolean }) {
  const lifetime = useCounter((s) => s.lifetime);
  const [state, setState] = useState<PersistState>("unknown");
  const [signedIn, setSignedIn] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [nearFull, setNearFull] = useState(false);

  useEffect(() => {
    let live = true;
    void requestPersistentStorage().then((s) => live && setState(s));
    setSignedIn(currentAccount() !== null);
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true,
    );

    /**
     * THE PRUNING THAT IS DELIBERATELY NOT HERE.
     *
     * The obvious answer to "local data grows for ever" is to delete the oldest
     * of it. This product does not, on the owner's explicit instruction: a
     * person's record of their own dhikr stays on their device permanently,
     * whether or not they have an account, and nothing but their own explicit
     * "clear data" ever removes it.
     *
     * That is the right call — a streak is worth nothing if the years behind it
     * quietly disappear — but it means the quota is a real ceiling rather than a
     * theoretical one. So it is watched and reported, and never acted on
     * without the reader.
     *
     * For scale: one session is roughly 300 bytes, so twenty a day for ten years
     * is about 22 MB, against an origin quota usually measured in hundreds of
     * megabytes. Reaching this warning should be close to impossible.
     */
    void storageEstimate().then((e) => {
      if (!live || !e || !e.quota) return;
      setNearFull(e.usage / e.quota > 0.8);
    });

    return () => {
      live = false;
    };
  }, []);

  if (nearFull) {
    return (
      <div
        role="alert"
        className={`rounded-[var(--radius-md)] border border-danger bg-danger-soft p-4 ${
          compact ? "" : "mt-4"
        }`}
      >
        <h3 className="text-[14px] font-semibold text-danger">
          This browser is running out of room
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg">
          Your counting history is safe and nothing has been deleted — we never
          remove your data to make space, and we never will. But the browser may
          start refusing to save new sessions.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
          Clearing other sites&rsquo; data from your browser settings is the
          usual fix. A backup file from More, or Premium, keeps a copy
          somewhere else, so this device stops being the only one.
        </p>
      </div>
    );
  }

  // Granted, installed, or signed in: there is nothing to warn about. A
  // signed-in user has a cloud copy, which is the real answer to this problem.
  if (state === "persisted" || standalone || signedIn || dismissed) return null;
  // Nothing to lose yet, or we simply do not know.
  if (state === "unknown" || lifetime < 100) return null;

  const ios = isIOS();

  return (
    <div
      role="status"
      className={`rounded-[var(--radius-md)] border border-warm bg-warm-soft p-4 ${
        compact ? "" : "mt-4"
      }`}
    >
      <h3 className="text-[14px] font-semibold text-warm">
        Your counts are not permanently safe on this device
      </h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fg">
        {ios
          ? "Safari deletes a website's saved data after about a week without a visit. Everything you have counted lives only in this browser, so it can go without warning."
          : "This browser has not promised to keep your data. It can be cleared when storage runs low, and everything you have counted lives only here."}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
        Two things fix it permanently, and both take a moment:
      </p>
      <ul className="mt-1.5 space-y-1 text-[13px] leading-relaxed text-fg-muted">
        <li>
          <strong className="text-fg">Add this to your home screen.</strong>{" "}
          {ios
            ? "Tap the share button in Safari, then Add to Home Screen."
            : "Install it from your browser menu."}{" "}
          Installed copies are never cleared automatically.
        </li>
        <li>
          <strong className="text-fg">Or get Premium.</strong> Your practice
          is then kept in your account as well, so losing this browser costs you
          nothing.
        </li>
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href="/premium/"
          className="inline-flex min-h-[44px] items-center rounded-full bg-accent px-4 text-[13px] font-medium text-fg-on-accent"
        >
          Keep a copy with Premium
        </a>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="min-h-[44px] rounded-full border border-border px-4 text-[13px] text-fg-muted"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
