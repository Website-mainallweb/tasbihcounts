"use client";

/**
 * The Tawaf and Sa'i face.
 * Specification sections 51 and 52.
 *
 * WHY THIS IS NOT THE RING
 *
 * The tasbih ring answers "how many of a large number have I said?", and it is
 * built for a number that climbs quickly. A rite is seven, walked. Seven is
 * small enough to show whole — every lap visible at once, done and not yet done
 * — which is what the Master's own UX sketch does, and it is the only honest
 * shape for a count where each unit takes minutes rather than a second.
 *
 * ACCIDENTAL-ACTION PROTECTION
 *
 * This is the reason the rite does not reuse the tap surface. A phone carried
 * in a hand around the Kaʿbah, in a crowd, will be touched. On the tasbih that
 * costs one count out of a hundred and undo fixes it. On a Tawaf it costs a
 * whole round, and a person who no longer trusts the number is a person who has
 * to start again. So the only thing that records a lap is the single large
 * labelled button below — the surrounding surface counts nothing at all — and
 * the button disables itself the moment the seventh lap lands, so there is no
 * eighth to press by accident.
 *
 * ADVERTISING
 *
 * Section 51 forbids advertising inside an active Tawaf. This renders inside
 * the counter frame, and `AdPlacement` has no value that puts an ad inside the
 * counter frame — the rule is unbreakable by construction rather than by
 * convention. See the note at the top of `core/rites.ts`.
 */

import type { RiteView } from "@/core/rites";

export function RiteStage({
  view,
  onComplete,
  onUndo,
  canUndo,
  format,
}: {
  view: RiteView;
  onComplete: () => void;
  onUndo: () => void;
  canUndo: boolean;
  /** Locale-aware number formatting, so Arabic-Indic numerals reach here too. */
  format: (n: number) => string;
}) {
  const { rite, completed, total, laps, isComplete, direction } = view;

  return (
    <div
      data-rite={rite.id}
      // The semantic boundary section 51 asks for: anything that later needs to
      // ask "is a rite being performed right now?" can read this attribute
      // rather than inferring it from the counter's internals.
      data-rite-active={isComplete ? undefined : ""}
      className="flex w-full flex-col items-center justify-center gap-1 px-2 text-center"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
        {rite.name}
      </p>

      <p className="mt-3 text-[13px] font-medium text-fg-muted">{rite.unit}</p>

      {/* The count, as the sketch has it: done over total, one line. */}
      <p
        className="counter-digits font-display leading-none text-fg"
        style={{ fontSize: "clamp(2.75rem, 13vw, 4.25rem)" }}
        // The number changes by one every few minutes, so a live region here is
        // useful rather than chattering. The tasbih deliberately throttles its
        // own; this one cannot outpace anybody.
        aria-live="polite"
      >
        {format(completed)}
        <span className="text-fg-subtle"> / {format(total)}</span>
      </p>

      {/* One dot per lap. Decorative: the line above already carries the number,
          and a screen reader reading seven list items adds nothing. */}
      <ul
        aria-hidden="true"
        className="mt-5 flex items-center justify-center gap-2.5"
      >
        {laps.map((done, i) => (
          <li
            key={i}
            className={`h-3 w-3 rounded-full border transition-colors duration-300 ${
              done ? "border-accent bg-accent" : "border-border-strong bg-transparent"
            }`}
            style={{ transitionTimingFunction: "var(--ease-brand)" }}
          />
        ))}
      </ul>

      {/* Sa'i only. Derived from the count, never stored, so undo cannot leave
          the heading pointing the wrong way. */}
      {direction ? (
        <p className="mt-4 text-[14.5px] font-medium text-fg" dir="ltr">
          {direction}
        </p>
      ) : null}

      {isComplete ? (
        <p className="mt-4 max-w-[30ch] text-[13.5px] leading-snug text-warm">
          {rite.name} complete — {format(total)} {rite.unitPlural.toLowerCase()}.
          Reset when you are ready to begin another.
        </p>
      ) : null}

      <div className="mt-6 flex w-full max-w-[320px] flex-col items-stretch gap-2">
        <button
          type="button"
          onClick={onComplete}
          disabled={isComplete}
          // 56px, well past the 44px floor of section 71.2. This is pressed
          // while walking, sometimes without looking at it.
          className="grid min-h-[56px] w-full place-items-center rounded-[var(--radius-lg)] border border-accent bg-accent px-6 text-[15.5px] font-semibold text-fg-on-accent shadow-soft transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
          style={{ transitionTimingFunction: "var(--ease-brand)" }}
        >
          {isComplete ? `${rite.name} complete` : rite.action}
        </button>

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="grid min-h-[44px] w-full place-items-center rounded-[var(--radius-lg)] border border-border bg-surface px-6 text-[14px] font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-35 disabled:hover:border-border disabled:hover:text-fg-muted"
        >
          Undo last {rite.unit.toLowerCase()}
        </button>
      </div>
    </div>
  );
}
