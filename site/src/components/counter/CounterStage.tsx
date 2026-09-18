"use client";

/**
 * The counter stage: layered bead ring, progress arc, breathing halo, tap
 * ripple and rolling digits.
 *
 * Specification sections 14, 15, 16, 25 and 0B.
 * The mark and the progress ring are one object, so the brand is the interface.
 */

import { useEffect, useRef, useState } from "react";
import { BeadStrand } from "./BeadStrand";
import type { CounterSkin } from "@/core/types";

export interface StageProps {
  progress: number;
  beads: number;
  display: string;
  target: number | null;
  targetLabel: string | null;
  roundLine: string | null;
  timerLine: string | null;
  pressed: boolean;
  /** Which face to draw. "beads" replaces the ring with a strung misbaha. */
  skin?: CounterSkin;
  milestoneId: number | null;
  size: string;
  countKey: number;
  /** The raw count. Rises even in countdown mode, where the display falls. */
  bubbleKey: number;
  /** The selected name. Rides up in a bubble on every count. */
  bubbleText?: string | null;
  bubbleArabic?: string | null;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

interface Bubble {
  id: number;
  drift: number;
  /** Alternate the script, so the bubbles do not read as one repeated label. */
  arabic: boolean;
}

const BUBBLE_MS = 2100;

export function CounterStage(props: StageProps) {
  const {
    progress,
    beads,
    display,
    targetLabel,
    roundLine,
    timerLine,
    pressed,
    milestoneId,
    size,
    countKey,
    bubbleKey,
    bubbleText,
    bubbleArabic,
    skin = "ring",
  } = props;

  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(bubbleKey);
  const bubbleTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Expose a ripple spawner on the element so the tap handler can call it
  // without re-rendering the whole tree on every pointer move.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const spawn = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail;
      const rect = host.getBoundingClientRect();
      const id = performance.now();
      setRipples((r) => [
        ...r.slice(-3),
        { id, x: detail.x - rect.left, y: detail.y - rect.top },
      ]);
      setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 640);
    };
    host.addEventListener("tc:ripple", spawn as EventListener);
    return () => host.removeEventListener("tc:ripple", spawn as EventListener);
  }, []);

  /* ---------- bubbles (the selected name, rising) ----------
   *
   * Driven by the count itself rather than by the pointer, so a keyboard
   * count, an auto count and a tap all behave the same. Never on a decrease,
   * so undo and reset stay quiet.
   */
  useEffect(() => {
    const prev = lastCount.current;
    lastCount.current = bubbleKey;
    // Exactly one step. A jump means hydration, a reset or a target change,
    // none of which is a count.
    if (bubbleKey !== prev + 1 || !bubbleText) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const id = performance.now();
    const drift = Math.round((Math.random() * 2 - 1) * 46);
    // At most four in the air at once, however fast the taps come.
    setBubbles((b) => [
      ...b.slice(-3),
      { id, drift, arabic: !!bubbleArabic && bubbleKey % 2 === 0 },
    ]);
    // Deliberately NOT cleaned up per run: the next count re-runs this effect,
    // and a per-run cleanup would cancel the previous bubble's removal and
    // leave it stuck on screen. Timers are cleared on unmount instead.
    bubbleTimers.current.push(
      setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), BUBBLE_MS),
    );
  }, [bubbleKey, bubbleText, bubbleArabic]);

  useEffect(
    () => () => {
      bubbleTimers.current.forEach(clearTimeout);
      bubbleTimers.current = [];
    },
    [],
  );

  const count = Math.min(Math.max(beads, 12), 60);
  const cx = 50;
  const cy = 50;
  const rOuter = 44;
  const rArc = 38;
  const p = Math.min(100, Math.max(0, progress));
  const activeBeads = Math.round((p / 100) * count);
  const markerAngle = -Math.PI / 2 + (p / 100) * Math.PI * 2;
  const mx = cx + rOuter * Math.cos(markerAngle);
  const my = cy + rOuter * Math.sin(markerAngle);
  const circ = 2 * Math.PI * rArc;

  return (
    <div
      ref={hostRef}
      data-counter-stage=""
      // The size arrives as a custom property rather than a width/height pair
      // so the stylesheet can cap it against the space actually left on a short
      // phone. An inline width beats every rule in the cascade, and that is how
      // the ring used to grow until it sat on top of the controls.
      className="counter-stage relative grid shrink-0 place-items-center"
      style={
        {
          ["--stage-px"]: size,
          transform: pressed ? "scale(0.982)" : "scale(1)",
          transition: "transform 150ms var(--ease-brand-out)",
        } as React.CSSProperties
      }
    >
      <span className="stage-halo" aria-hidden="true" />

      {/* Gap 11: the strand face. Same progress, same accessibility posture —
          purely decorative, with the surrounding button carrying the meaning. */}
      {skin === "beads" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[6%] bottom-[4%]"
        >
          <BeadStrand progress={progress} beads={beads} />
        </span>
      ) : null}

      {ripples.map((r) => (
        <span
          key={r.id}
          aria-hidden="true"
          className="ripple-dot"
          style={{ left: r.x, top: r.y }}
        />
      ))}

      {bubbles.map((b) => (
        <span
          key={b.id}
          aria-hidden="true"
          className="bubble"
          style={{ ["--drift"]: b.drift + "px" } as React.CSSProperties}
        >
          {b.arabic ? (
            <span className="bubble-ar" lang="ar" dir="rtl">
              {bubbleArabic}
            </span>
          ) : (
            bubbleText
          )}
        </span>
      ))}

      {milestoneId ? (
        <span
          key={milestoneId}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-warm"
          style={{ animation: "tc-burst 780ms var(--ease-brand-out) forwards" }}
        />
      ) : null}

      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute inset-0"
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient id="tcArc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--warm)" stopOpacity="0.85" />
          </linearGradient>
          <radialGradient id="tcDisc">
            <stop offset="60%" stopColor="var(--surface)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.07" />
          </radialGradient>
        </defs>

        <circle cx={cx} cy={cy} r={rArc - 3} fill="url(#tcDisc)" />

        {/* track */}
        <circle
          cx={cx}
          cy={cy}
          r={rArc}
          fill="none"
          stroke="var(--border)"
          strokeWidth="2.4"
        />

        {/* progress arc */}
        <circle
          cx={cx}
          cy={cy}
          r={rArc}
          fill="none"
          stroke="url(#tcArc)"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - p / 100)}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 300ms var(--ease-brand-out)" }}
        />

        {/* bead ring, the mark */}
        {Array.from({ length: count }, (_, i) => {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
          const x = cx + rOuter * Math.cos(a);
          const y = cy + rOuter * Math.sin(a);
          const on = i < activeBeads;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={on ? 1.45 : 1.05}
              fill={on ? "var(--accent)" : "var(--border-strong)"}
              opacity={on ? 0.95 : 0.6}
              style={{ transition: "r 220ms var(--ease-brand-out), fill 220ms var(--ease)" }}
            />
          );
        })}

        {/* the one warm marker bead */}
        <circle
          cx={mx}
          cy={my}
          r={4.2}
          fill="var(--warm)"
          opacity={0.18}
          style={{ transition: "cx 300ms var(--ease-brand-out), cy 300ms var(--ease-brand-out)" }}
        />
        <circle
          cx={mx}
          cy={my}
          r={2.5}
          fill="var(--warm)"
          style={{ transition: "cx 300ms var(--ease-brand-out), cy 300ms var(--ease-brand-out)" }}
        />
      </svg>

      <div className="relative flex max-w-full flex-col items-center">
        {/* The size follows the number's own length. A seven-digit count —
            "2 lakh like 200000" was a real request, and MAX_TARGET is
            9,999,999 — used to render at the same 54px as a single digit and
            spill straight out of the ring and off a 320px screen. */}
        <span
          key={countKey}
          aria-hidden="true"
          className="counter-digits max-w-full text-fg"
          style={
            {
              ["--digits"]: Math.max(1, display.length),
              fontSize: "min(34cqw, calc(122cqw / var(--digits)))",
              animation: "tc-roll-in 220ms var(--ease-brand-out) both",
            } as React.CSSProperties
          }
        >
          {display}
        </span>

        {targetLabel ? (
          <span className="tabular mt-0.5 text-[13.5px] font-medium text-fg-muted">
            {targetLabel}
          </span>
        ) : null}

        {roundLine ? (
          <span className="tabular mt-0.5 text-[11.5px] text-fg-subtle">{roundLine}</span>
        ) : null}

        {timerLine ? (
          <span className="tabular mt-2 rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-fg-muted">
            {timerLine}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Called by the tap handler to spawn a ripple at the pointer position. */
export function spawnRipple(x: number, y: number) {
  const el = document.querySelector("[data-counter-stage]");
  el?.dispatchEvent(new CustomEvent("tc:ripple", { detail: { x, y } }));
}
