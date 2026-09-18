"use client";

import Link from "next/link";

import { dayKey } from "@/lib/counter/day";
import { summarise, type History } from "@/lib/counter/streak";
import { useCounterState } from "@/lib/counter/useCounterState";

/**
 * The run, in the header, on every page.
 *
 * Absent until there is a run to show. A chip reading "0" on a first visit is
 * not encouragement, it is a scoreboard nobody asked for — and it would be the
 * one thing a brand new visitor sees beside the counter.
 */
export default function StreakChip() {
  const state = useCounterState();
  const s = summarise((state?.hist ?? {}) as History, dayKey());

  if (s.current < 1) return null;

  return (
    <Link
      className="streak-chip"
      href="/streak/"
      data-risk={s.atRisk || undefined}
      title={
        s.atRisk
          ? `${s.current} day streak — today is still open`
          : `${s.current} day streak`
      }
    >
      <span aria-hidden="true">🔥</span>
      <b>{s.current}</b>
      <span className="sr-only">
        day streak{s.atRisk ? ", today still open" : ""}
      </span>
    </Link>
  );
}
