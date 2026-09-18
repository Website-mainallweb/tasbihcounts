"use client";

import { useEffect, useSyncExternalStore } from "react";
import { CounterTool, type Preselect } from "@/components/counter/CounterTool";
import * as Ledger from "@/lib/counter/ledger";
import { useCounter } from "@/stores/counter-store";

/**
 * The counter as the site mounts it: the Tasbih counter on screen, and the ledger
 * (lib/counter/ledger.ts) underneath it keeping the record that Stats, Streak,
 * backups and the account sync all read.
 *
 * Everything inside is scoped under `.tc`, the class its stylesheet is written
 * against (app/counter.css), so its utilities never reach the header, the
 * article or the footer.
 */
export default function TasbihCounter({ preselect }: { preselect?: Preselect }) {
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
    <div className="tc">
      <LedgerNotice />
      <CounterTool preselect={preselect} />
    </div>
  );
}

/** Backup nudges, restore questions, "add to my account" — one at a time. */
function LedgerNotice() {
  const view = useSyncExternalStore(Ledger.subscribe, Ledger.getView, Ledger.getServerView);
  const n = view.notice;
  if (!n) return null;

  return (
    <div
      role="status"
      className={`mx-auto mb-3 flex w-full max-w-[720px] items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-[13.5px] leading-relaxed ${
        n.tone === "bad"
          ? "border-danger bg-danger-soft text-fg"
          : n.tone === "good"
            ? "border-accent-line bg-accent-soft text-fg"
            : "border-border bg-surface text-fg"
      }`}
    >
      <p className="min-w-0 flex-1">{n.text}</p>
      {n.actionLabel ? (
        <button
          type="button"
          onClick={() => {
            Ledger.dismissNotice();
            n.onAction?.();
          }}
          className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-fg-on-accent"
        >
          {n.actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => Ledger.dismissNotice()}
        className="shrink-0 px-1 text-fg-subtle hover:text-fg"
      >
        ✕
      </button>
    </div>
  );
}
