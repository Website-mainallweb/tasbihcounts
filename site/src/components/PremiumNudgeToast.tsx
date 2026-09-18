"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useHasSession } from "@/lib/auth-ui";
import { CURRENT_PLAN } from "@/lib/payments/plans";

const SEEN_KEY = "njc.nudge";
const SHOW_MS = 12_000;

const DEVANAGARI = "०१२३४५६७८९";
const toNumber = (text: string | null | undefined) =>
  Number((text ?? "").replace(/[०-९]/g, (d) => String(DEVANAGARI.indexOf(d))).replace(/[^\d]/g, "")) || 0;

const today = () => new Date().toDateString();

function seenToday(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === today();
  } catch {
    return true; // storage refused: never nag a browser that cannot remember
  }
}

/**
 * A small, polite offer the moment a mala is completed — the one time a person
 * has just felt what the counter is worth. At most once a day, never for a
 * Premium browser or a signed-in one, and never on top of the ring: a toast in
 * the path of repeated taps would be tapped by accident, which is also what
 * AdSense forbids near a tap target.
 *
 * It watches the counter's own "Mala" figure rather than asking the engine for
 * an event, so the counter itself is untouched.
 */
export default function PremiumNudgeToast() {
  const pathname = usePathname();
  const hasSession = useHasSession();
  const [open, setOpen] = useState(false);
  /* B18: in the counter's language, read when it appears. */
  const [hindi, setHindi] = useState(false);

  useEffect(() => {
    if (pathname !== "/" || hasSession) return;
    let observer: MutationObserver | null = null;
    let timer = 0;
    let tries = 0;

    const attach = () => {
      const figure = document.getElementById("njcPMala");
      if (!figure) {
        if (tries++ < 60) timer = window.setTimeout(attach, 250);
        return;
      }
      let last = toNumber(figure.textContent);
      observer = new MutationObserver(() => {
        const now = toNumber(figure.textContent);
        const grew = now > last;
        last = now;
        if (!grew || document.documentElement.dataset.premium === "1" || seenToday()) return;
        try {
          localStorage.setItem(SEEN_KEY, today());
        } catch {
          return;
        }
        setHindi(document.documentElement.lang === "hi");
        setOpen(true);
      });
      observer.observe(figure, { childList: true, characterData: true, subtree: true });
    };
    attach();
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [pathname, hasSession]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setOpen(false), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return (
    <div className="nudge" role="status" lang={hindi ? "hi" : "en"}>
      <span className="nudge-icon" aria-hidden="true">
        🪷
      </span>
      <div className="nudge-body">
        <p className="nudge-title">{hindi ? "एक माला पूरी — बहुत सुंदर।" : "A mala complete — beautiful."}</p>
        <p className="nudge-text">
          {hindi
            ? `अपना हर जप सभी डिवाइस पर सुरक्षित रखें, बिना विज्ञापन। Premium एक बार ${CURRENT_PLAN.display}, जीवन भर के लिए।`
            : `Keep every count safe across your devices, with no ads. Premium is ${CURRENT_PLAN.display} once, for life.`}
        </p>
        <div className="nudge-actions">
          <Link href="/premium/" className="btn btn-primary btn-sm" prefetch={false} onClick={() => setOpen(false)}>
            {hindi ? "Premium देखें" : "See Premium"}
          </Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
            {hindi ? "अभी नहीं" : "Not now"}
          </button>
        </div>
      </div>
    </div>
  );
}
