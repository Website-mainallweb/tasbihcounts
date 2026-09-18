"use client";

/**
 * ROUND · TODAY · STREAK.
 * Specification section 99, added from design-research.md section 3.5:
 * every serious tool in both traditions converged on the same three-value
 * header. Convergent evolution across two religions is strong evidence.
 */

import { formatCount } from "@/core/format";
import type { NumeralStyle } from "@/core/types";

export function HeaderStats({
  round,
  totalRounds,
  today,
  streak,
  locale,
  numerals,
}: {
  round: number | null;
  totalRounds: number | null;
  today: number;
  streak: number;
  locale: string;
  numerals: NumeralStyle;
}) {
  const n = (x: number) => formatCount(x, locale, numerals);

  return (
    <div className="grid grid-cols-3 gap-2 border-b border-border pb-4">
      <Stat
        label="Round"
        value={round ? (totalRounds ? `${n(round)}/${n(totalRounds)}` : n(round)) : "—"}
      />
      <Stat label="Today" value={n(today)} emphasis />
      <Stat label="Streak" value={streak > 0 ? `${n(streak)}d` : "—"} />
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-subtle">
        {label}
      </div>
      <div
        className={`tabular mt-1 font-display leading-none ${
          emphasis ? "text-[22px] text-fg" : "text-[19px] text-fg-muted"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
