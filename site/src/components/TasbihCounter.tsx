"use client";

import { useEffect } from "react";
import NjcCounter from "@/components/njc/NjcCounter";
import { stageSize } from "@/components/njc/counter-size";
import * as Ledger from "@/lib/counter/ledger";
import { useCounter } from "@/stores/counter-store";

/*
 * Runs inside the server HTML, straight after the counter's markup and before the
 * first paint, so the ring is drawn at its real size from the start. Without it
 * the ring appeared at a CSS guess and grew once the page hydrated, pushing the
 * controls and the article down. The counter uses the same function on every
 * resize, so the two can never disagree.
 */
const PRESIZE = `(function(){try{var R=document.getElementById("njc");var c=R.querySelector(".njc-col");if(c)R.style.setProperty("--njc-coltop",Math.round(c.getBoundingClientRect().top-R.getBoundingClientRect().top)+"px");var s=(${String(stageSize)})(R);if(s)R.querySelector("#njcStage").style.setProperty("--stage-px",s+"px")}catch(e){}})();`;

/**
 * The counter as the site mounts it: the counter on screen (components/njc), and
 * the ledger (lib/counter/ledger.ts) underneath it keeping the record that Stats,
 * Streak, backups and the account sync all read.
 */
export default function TasbihCounter() {
  useEffect(() => {
    const stop = Ledger.start();
    const recompute = () => useCounter.getState().recomputeStats();
    const unsubscribe = Ledger.subscribe(recompute);
    recompute();
    return () => {
      unsubscribe();
      stop();
    };
  }, []);

  return (
    <>
      <div className="njc-host">
        <NjcCounter />
      </div>
      {/* Parsed and run by the browser with the server HTML only; a client-side
          navigation inserts it inert and the counter sizes the ring instead. */}
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: PRESIZE }} />
    </>
  );
}
