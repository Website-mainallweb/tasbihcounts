"use client";

/**
 * Share (gap 15).
 * Specification sections 30.3, 131.
 *
 * WHAT IS SHARED, AND WHAT IS NOT
 * A streak and a total. Never which dhikr, never a session, never a date, never
 * a name. Section 30.3 sets the tone — encouragement, never guilt — and that
 * applies to what someone posts about themselves as much as to what the app
 * says to them, so the text is plain and carries no boast and no challenge.
 *
 * The whole thing is opt-in by construction: nothing is shared until the button
 * is pressed, and the text is visible before it goes anywhere.
 *
 * `navigator.share` is used where it exists, which on a phone opens the
 * system sheet. Everywhere else it copies to the clipboard, which is the only
 * honest desktop equivalent — a row of network buttons would be an invitation
 * for three trackers this site does not load.
 */

import { useState } from "react";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const SITE = { name: SITE_NAME, url: SITE_URL, domain: new URL(SITE_URL).hostname.replace(/^www\./, "") };
import { formatCount } from "@/core/format";
import { useSettings } from "@/stores/settings-store";
import { useCounter } from "@/stores/counter-store";

type State = "idle" | "copied" | "failed";

export function ShareButton({ compact }: { compact?: boolean }) {
  const settings = useSettings();
  const today = useCounter((s) => s.today);
  const streak = useCounter((s) => s.streak.current);
  const lifetime = useCounter((s) => s.lifetime);
  const [state, setState] = useState<State>("idle");

  const n = (x: number) => formatCount(x, settings.locale, settings.numerals);

  // Written out rather than assembled from fragments, so no branch can produce
  // "a 0 day streak" or "1 days".
  const text = (() => {
    const day = (d: number) => `${n(d)} day${d === 1 ? "" : "s"}`;
    if (streak >= 2 && today > 0) {
      return `${day(streak)} of dhikr in a row, ${n(today)} today. Counted on ${SITE.domain}`;
    }
    if (today > 0) {
      return `${n(today)} dhikr today. Counted on ${SITE.domain}`;
    }
    if (lifetime > 0) {
      return `${n(lifetime)} dhikr counted so far on ${SITE.domain}`;
    }
    return `A free tasbih counter that works offline — ${SITE.domain}`;
  })();

  const share = async () => {
    const payload = { title: SITE.name, text, url: SITE.url };

    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share(payload);
        return;
      }
    } catch {
      // A cancelled system sheet throws. That is a decision, not a failure, so
      // it falls through to the clipboard rather than showing an error.
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${SITE.url}`);
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
      setTimeout(() => setState("idle"), 3500);
    }
  };

  return (
    <div className={compact ? "" : "mt-2"}>
      <button
        type="button"
        onClick={() => void share()}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-border-strong px-4 text-[13.5px] font-medium text-fg transition-colors hover:bg-surface-sunken"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 15V4m0 0L8 8m4-4l4 4M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Could not copy"
            : "Share my practice"}
      </button>

      {/* The exact text, before it goes anywhere. Nobody should have to trust
          an app about what it is going to post on their behalf. */}
      <p className="mt-1.5 px-1 text-[11.5px] leading-relaxed text-fg-subtle">
        Shares only this: &ldquo;{text}&rdquo; — never which dhikr you recite.
      </p>
    </div>
  );
}
