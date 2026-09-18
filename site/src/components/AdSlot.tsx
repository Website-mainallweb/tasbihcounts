"use client";

import { useEffect, useRef, useState } from "react";
import { ADSENSE_ACCOUNT } from "@/lib/site";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * The three AdSense unit types the site uses. They differ only in the
 * attributes AdSense reads off the <ins>, so one component covers all three
 * and the caller picks the one that suits the position.
 */
type AdFormat = "display" | "in-article" | "multiplex";

const INS_PROPS: Record<AdFormat, Record<string, string>> = {
  display: { "data-ad-format": "auto", "data-full-width-responsive": "true" },
  "in-article": { "data-ad-format": "fluid", "data-ad-layout": "in-article" },
  multiplex: { "data-ad-format": "autorelaxed" },
};

type Props = {
  /**
   * The AdSense slot id. Empty turns the position off: no <ins>, no push, no
   * request — which is what a slot whose unit does not exist yet needs, since
   * asking with a stale id only produces an error in the console.
   */
  slot: string;
  format?: AdFormat;
  /**
   * Height held open while the ad loads, so the copy underneath does not jump
   * when it arrives. Reserved on the wrapper, never on the <ins>: AdSense
   * cannot size a responsive unit inside a fixed-height box.
   */
  minHeight?: number;
  className?: string;
  /**
   * Only request an ad from this viewport width up. A slot the layout hides is
   * still a slot that asks for an ad and then never shows it, which is an
   * impression nobody can see — so the narrow case renders no unit at all.
   */
  minWidth?: number;
};

export default function AdSlot({
  slot,
  format = "display",
  minHeight = 280,
  className,
  minWidth,
}: Props) {
  const ins = useRef<HTMLModElement>(null);
  const pushed = useRef(false);
  const [state, setState] = useState<"loading" | "filled" | "unfilled">("loading");
  // Starts false so the server and the first client render agree; a match
  // flips it on after mount.
  const [wide, setWide] = useState(minWidth === undefined);

  useEffect(() => {
    if (minWidth === undefined) return;
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const read = () => setWide(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, [minWidth]);

  useEffect(() => {
    const el = ins.current;
    if (!el) return;

    // In development React mounts effects twice, and a second push on the same
    // <ins> is the "already have ads in this tag" error. AdSense stamps the
    // element once it has claimed it, so that stamp is the real guard.
    // Two reasons not to ask for an ad at all: the admin panel's ads kill switch
    // (docs/ADMIN.md §3.8), stamped on <html> by the layout, and a Premium
    // browser (lib/premium-flag.ts). Either way no request is made and the slot
    // folds away rather than holding its reserved height open.
    const html = document.documentElement.dataset;
    if (html.ads === "off" || html.premium === "1") {
      queueMicrotask(() => setState("unfilled"));
      return;
    }

    if (!pushed.current && !el.dataset.adsbygoogleStatus) {
      pushed.current = true;
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        // Blocked by an extension, or the loader never arrived. Nothing to do:
        // the slot stays collapsed rather than leaving a hole in the page.
        // Queued rather than set outright: a synchronous setState inside an
        // effect makes React render twice before it paints once.
        queueMicrotask(() => setState("unfilled"));
        return;
      }
    }

    // AdSense writes data-ad-status="filled" | "unfilled" when the auction
    // settles. Until then the reserved height stands; an unfilled slot folds
    // away so a page with no ads to show does not read as broken.
    const read = () => {
      const status = el.getAttribute("data-ad-status");
      if (status === "filled" || status === "unfilled") setState(status);
    };
    // AdSense may have settled this slot before the effect ran — on a remount,
    // say. Read it once, out of band for the same reason as above.
    queueMicrotask(read);

    const observer = new MutationObserver(read);
    observer.observe(el, { attributes: true, attributeFilter: ["data-ad-status"] });

    // A blocked or missing loader never writes a status at all: the push just
    // sits in the queue. Without this the reserved height would stand empty for
    // the whole visit, so give the auction a few seconds and then fold away.
    const giveUp = setTimeout(() => {
      if (!el.getAttribute("data-ad-status")) setState("unfilled");
    }, 4000);

    return () => {
      observer.disconnect();
      clearTimeout(giveUp);
    };
  }, [wide]);

  if (!slot || !wide) return null;

  return (
    <aside
      className={className ? `ad ${className}` : "ad"}
      data-ad-state={state}
      style={{ "--ad-min": `${minHeight}px` } as React.CSSProperties}
    >
      {/* Google allows "Advertisement" or "Sponsored links" and nothing else. */}
      <span className="ad-label">Advertisement</span>
      <ins
        ref={ins}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_ACCOUNT}
        data-ad-slot={slot}
        {...INS_PROPS[format]}
      />
    </aside>
  );
}
