"use client";

import { useEffect, useRef } from "react";
import initNamJapCounter from "./counter-engine";
import { counterMarkup } from "./counter-markup";
import { applyTheme } from "@/lib/theme-color";
import { stageSize } from "./counter-size";

/*
 * Runs inside the server HTML, straight after the counter's markup and before the
 * first paint, so the ring is drawn at its real size from the start. Without it
 * the ring appeared at a CSS guess and grew once the engine booted, pushing the
 * controls and the article down (CLS 0.26). The engine keeps using the same
 * function on every resize, so the two can never disagree.
 */
const PRESIZE = `(function(){try{var R=document.getElementById("njc");var c=R.querySelector(".njc-col");if(c)R.style.setProperty("--njc-coltop",Math.round(c.getBoundingClientRect().top-R.getBoundingClientRect().top)+"px");var s=(${String(stageSize)})(R);if(s)R.querySelector("#njcStage").style.setProperty("--stage-px",s+"px")}catch(e){}})();`;

/**
 * The counter ships as one self-contained widget: markup, a scoped .njc
 * stylesheet and a vanilla engine. React only mounts the markup and starts
 * the engine, then keeps its hands off the subtree.
 *
 * The engine also writes its active theme onto #njc. We mirror that onto
 * <html> so the header, footer and article take the same palette.
 */
export default function NamJapCounter() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /*
     * The engine hands back a teardown, and it has to be called.
     *
     * A client-side navigation to another page and back unmounts this component
     * and mounts a fresh one. The old engine's window listeners, intervals and —
     * since the one-tab-counts election — its BroadcastChannel all survive that,
     * so two engines end up running at once. The old election keeps heartbeating,
     * the new counter concludes another tab owns the count, and it stops
     * accepting taps. The widget dies silently on the second visit, which is
     * exactly the kind of failure nobody reports and everybody feels.
     */
    const stopEngine = initNamJapCounter();

    const njc = document.getElementById("njc");
    if (!njc) return stopEngine;

    const sync = () => {
      const theme = njc.getAttribute("data-theme") || "prabhat";
      applyTheme(theme);
    };
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(njc, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      observer.disconnect();
      stopEngine();
    };
  }, []);

  return (
    <>
      <div
        ref={host}
        className="njc-host"
        dangerouslySetInnerHTML={{ __html: counterMarkup }}
      />
      {/* Parsed and run by the browser with the server HTML only; a client-side
          navigation inserts it inert and the engine sizes the ring instead. */}
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: PRESIZE }} />
    </>
  );
}
