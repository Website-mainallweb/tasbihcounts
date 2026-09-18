"use client";

/**
 * The strung misbaha (gap 11).
 *
 * WHY A SECOND FACE EXISTS AT ALL
 * The bead ring is the brand mark and the progress indicator in one object, and
 * it is the right default. But a large share of the people this is built for
 * have held a physical tasbih their whole lives, and an abstract ring is not
 * what their hands know. "The ring is a better information design" is true and
 * it is not an argument that wins with somebody who wants the thing they
 * already own.
 *
 * So this draws a strand: beads on a cord, filled up to the count, with the
 * marker bead travelling along it and the imam bead at the head.
 *
 * IT IS THE SAME COUNTER
 * Same progress value, same SVG approach, same accessibility posture — purely
 * decorative, `aria-hidden`, with the surrounding button carrying the meaning.
 * Nothing about counting, sessions or statistics changes with the skin.
 */

import { useMemo } from "react";

interface Props {
  /** 0 to 100. */
  progress: number;
  /** How many beads the strand shows. Clamped to something drawable. */
  beads?: number;
  muted?: boolean;
}

export function BeadStrand({ progress, beads = 33, muted }: Props) {
  const count = Math.min(Math.max(beads, 11), 40);

  const layout = useMemo(() => {
    // A shallow arc rather than a straight line: a strand held in the hand
    // hangs, and a flat row reads as a progress bar with circles on it.
    const width = 100;
    const height = 46;
    const cx = width / 2;
    const dip = 13;

    return Array.from({ length: count }, (_, i) => {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = 6 + t * (width - 12);
      // A parabola through the three anchor points, normalised to the dip.
      const y = height / 2 - dip + dip * 4 * (t - 0.5) * (t - 0.5) * -1 + dip;
      return { x, y, i, t, cx };
    });
  }, [count]);

  const filled = Math.round((Math.min(100, Math.max(0, progress)) / 100) * count);

  return (
    <svg
      viewBox="0 0 100 46"
      className={`w-full transition-opacity duration-300 ${muted ? "opacity-40" : ""}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* The cord. Drawn first so every bead sits on top of it. */}
      <path
        d={layout
          .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
          .join(" ")}
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth="0.7"
        strokeLinecap="round"
      />

      {layout.map((p) => {
        const isFilled = p.i < filled;
        const isMarker = p.i === filled - 1 && filled > 0;
        return (
          <circle
            key={p.i}
            cx={p.x}
            cy={p.y}
            r={isMarker ? 2.5 : 1.7}
            fill={
              isMarker
                ? "var(--warm)"
                : isFilled
                  ? "var(--accent)"
                  : "var(--border)"
            }
            style={{
              transition: "fill 220ms var(--ease-out), r 220ms var(--ease-out)",
            }}
          />
        );
      })}

      {/* The imam bead — the elongated head bead every misbaha has, and the
          detail that makes this read as a tasbih rather than as dots. */}
      <ellipse
        cx={layout[0]?.x ?? 6}
        cy={(layout[0]?.y ?? 23) - 4.2}
        rx="1.5"
        ry="3.2"
        fill="var(--accent)"
        opacity="0.85"
      />
    </svg>
  );
}
