"use client";

/**
 * Targets, rounds, step size and starting count.
 * Specification sections 19, 20, 21, 22, 135, and 19.4 from the research.
 *
 * Section 20 is mandatory: every target is labelled either "Source available"
 * or "Your goal". A user goal is never presented as a religious recommendation.
 */

import { useState } from "react";
import { Sheet, SheetSection, Row } from "@/components/ui/Sheet";
import { useCounter } from "@/stores/counter-store";
import { getDhikr } from "@/content/dhikr";
import { normaliseTarget, MAX_TARGET } from "@/core/format";
import { allows } from "@/core/counter";

const GENERIC = [33, 99, 100, 313, 1000];
const ROUND_SIZES = [33, 100, 108, 1000];

export function TargetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useCounter();
  const [custom, setCustom] = useState("");
  const [start, setStart] = useState("");

  const dhikr = getDhikr(s.state.dhikrId);
  const canTarget = allows(s.state.mode, "target");
  const canRounds = allows(s.state.mode, "rounds");

  // Context-aware options, not every number for every dhikr (section 19).
  const offered = dhikr?.targets.length
    ? dhikr.targets
    : GENERIC.map((value) => ({ value, kind: "user-goal" as const }));

  if (!canTarget) {
    return (
      <Sheet open={open} onClose={onClose} title="Target">
        <p className="px-1 py-6 text-[14px] leading-relaxed text-fg-muted">
          A guided routine sets its own target for each step, so the target
          selector is hidden while it is running. Leave the routine to choose your
          own target again.
        </p>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Target">
      <SheetSection label="Choose a target">
        <div className="grid grid-cols-3 gap-2">
          {offered.map((t) => {
            const active = s.state.target === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  s.setTarget(t.value, t.kind);
                  onClose();
                }}
                className={`rounded-[var(--radius-sm)] border px-2 py-3 text-center transition-all active:scale-[0.97] ${
                  active
                    ? "border-accent bg-accent-soft"
                    : "border-border bg-surface hover:border-border-strong"
                }`}
              >
                <span className="tabular block font-display text-[20px] font-semibold">
                  {t.value}
                </span>
                <span
                  className={`mt-0.5 block text-[10px] font-medium leading-tight ${
                    t.kind === "source-backed" ? "text-accent" : "text-fg-subtle"
                  }`}
                >
                  {t.kind === "source-backed" ? "Source available" : "Your goal"}
                </span>
              </button>
            );
          })}
        </div>

        {offered.some((t) => t.kind === "source-backed") ? (
          <p className="mt-3 px-1 text-[12px] leading-relaxed text-fg-subtle">
            “Source available” marks a count with reviewed evidence behind it.
            Everything else is a personal goal, and the app makes no religious
            claim about it.
          </p>
        ) : null}
      </SheetSection>

      <SheetSection label="Custom target">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = normaliseTarget(custom);
            if (n) {
              s.setTarget(n, "user-goal");
              setCustom("");
              onClose();
            }
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            maxLength={7}
            placeholder={`Any number up to ${MAX_TARGET.toLocaleString("en-US")}`}
            aria-label="Custom target"
            className="tabular w-full rounded-[var(--radius-sm)] border border-border bg-surface-sunken px-3 py-3 text-[15px] outline-none focus-visible:border-accent"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-accent px-5 text-[14px] font-medium text-fg-on-accent"
          >
            Set
          </button>
        </form>
        <Row
          label="No target"
          hint="Count freely with no end point"
          onClick={() => {
            s.setTarget(null);
            onClose();
          }}
        />
      </SheetSection>

      {canRounds ? (
        <SheetSection label="Rounds">
          <p className="mb-2 px-1 text-[12px] leading-relaxed text-fg-subtle">
            A round is a cycle inside the total. Rounds stay off until you turn
            them on, however large the target is.
          </p>
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => s.setRounds(null)}
              className={`rounded-[var(--radius-sm)] border px-2 py-2.5 text-[13px] font-medium min-h-[44px] ${
                !s.state.roundSize
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-fg-muted"
              }`}
            >
              Off
            </button>
            {ROUND_SIZES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => s.setRounds(n)}
                className={`tabular min-h-[44px] rounded-[var(--radius-sm)] border px-2 py-2.5 text-[13px] font-medium ${
                  s.state.roundSize === n
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-fg-muted"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </SheetSection>
      ) : null}

      <SheetSection label="Count by">
        <div className="grid grid-cols-3 gap-2">
          {[1, 3, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => s.setStep(n)}
              className={`tabular rounded-[var(--radius-sm)] border px-2 py-2.5 text-[14px] font-medium ${
                s.state.step === n
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-fg-muted"
              }`}
            >
              +{n}
            </button>
          ))}
        </div>
      </SheetSection>

      <SheetSection label="Start from a number">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(start);
            if (Number.isFinite(n)) {
              s.setStartingCount(n);
              setStart("");
              onClose();
            }
          }}
        >
          <input
            value={start}
            onChange={(e) => setStart(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            maxLength={7}
            placeholder="Continue from where you left off"
            aria-label="Starting count"
            className="tabular w-full rounded-[var(--radius-sm)] border border-border bg-surface-sunken px-3 py-3 text-[15px] outline-none focus-visible:border-accent"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full border border-border px-5 text-[14px] font-medium text-fg-muted"
          >
            Set
          </button>
        </form>
      </SheetSection>
    </Sheet>
  );
}
