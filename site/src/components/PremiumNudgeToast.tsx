"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useHasSession } from "@/lib/auth-ui";
import * as Ledger from "@/lib/counter/ledger";
import { dayKey } from "@/lib/counter/day";
import { CURRENT_PLAN } from "@/lib/payments/plans";

const SEEN_KEY = "njc.nudge";
const SHOW_MS = 12_000;

const today = () => new Date().toDateString();

function seenToday(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === today();
  } catch {
    return true; // storage refused: never nag a browser that cannot remember
  }
}

/**
 * A small, polite offer the moment a round is completed — the one time a person
 * has just felt what the counter is worth. At most once a day, never for a
 * Premium browser or a signed-in one, and never on top of the ring: a toast in
 * the path of repeated taps would be tapped by accident, which is also what
 * AdSense forbids near a tap target.
 *
 * It watches today's completed rounds in the ledger (lib/counter/ledger.ts), so
 * the counter itself knows nothing about it.
 */
export default function PremiumNudgeToast() {
  const pathname = usePathname();
  const hasSession = useHasSession();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (pathname !== "/" || hasSession) return;
    const rounds = () => Ledger.getView().hist[dayKey()]?.r ?? 0;
    let last = rounds();
    return Ledger.subscribe(() => {
      const now = rounds();
      const grew = now > last;
      last = now;
      if (!grew || document.documentElement.dataset.premium === "1" || seenToday()) return;
      try {
        localStorage.setItem(SEEN_KEY, today());
      } catch {
        return;
      }
      setOpen(true);
    });
  }, [pathname, hasSession]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setOpen(false), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return (
    <div className="nudge" role="status">
      <span className="nudge-icon" aria-hidden="true">
        ✨
      </span>
      <div className="nudge-body">
        <p className="nudge-title">A round complete — MashaAllah.</p>
        <p className="nudge-text">
          {`Keep every count safe across your devices, with no ads. Premium is ${CURRENT_PLAN.display} once, for life.`}
        </p>
        <div className="nudge-actions">
          <Link href="/premium/" className="btn btn-primary btn-sm" prefetch={false} onClick={() => setOpen(false)}>
            See Premium
          </Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
