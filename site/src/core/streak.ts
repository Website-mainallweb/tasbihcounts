/**
 * Streak and daily totals, computed only from localDate.
 * Specification sections 29 and 30.
 *
 * Rules honoured here:
 *  - a travelling user never loses a streak because of a time-zone change
 *  - a day is never removed retroactively by a later sync
 *  - two devices writing the same localDate is one day, not two
 */

import type { DailyTotal, Session, StreakInfo } from "./types";
import { addDays, toLocalDate, weekWindow } from "./dates";

export function rollUp(sessions: Session[]): Map<string, DailyTotal> {
  const map = new Map<string, DailyTotal>();

  for (const s of sessions) {
    if (s.count <= 0) continue;
    const day = map.get(s.localDate) ?? {
      localDate: s.localDate,
      count: 0,
      sessions: 0,
      byDhikr: {},
    };
    day.count += s.count;
    day.sessions += 1;
    day.byDhikr[s.dhikrId] = (day.byDhikr[s.dhikrId] ?? 0) + s.count;
    map.set(s.localDate, day);
  }

  return map;
}

/**
 * Today's total = every sealed session for today, plus the count of the session
 * still open. The open part is what makes the header number move on every tap
 * (section 29.1).
 */
export function todayTotal(
  totals: Map<string, DailyTotal>,
  openCount = 0,
  today = toLocalDate(),
): number {
  return (totals.get(today)?.count ?? 0) + Math.max(0, openCount);
}

export function lifetimeTotal(totals: Map<string, DailyTotal>): number {
  let n = 0;
  for (const d of totals.values()) n += d.count;
  return n;
}

/** A day counts toward the streak when its total is at least one. */
export function computeStreak(
  totals: Map<string, DailyTotal>,
  locale = "en",
  today = toLocalDate(),
  openCount = 0,
): StreakInfo {
  const done = (d: string) =>
    (totals.get(d)?.count ?? 0) > 0 || (d === today && openCount > 0);

  // Current streak: walk backwards from today. If today is still empty the
  // streak is not broken yet, so start the walk at yesterday.
  let cursor = done(today) ? today : addDays(today, -1);
  let current = 0;
  while (done(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  // Longest streak across everything recorded.
  const days = [...totals.keys()].filter((d) => (totals.get(d)?.count ?? 0) > 0).sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  if (current > longest) longest = current;

  const week = weekWindow(locale, today).map((w) => ({
    ...w,
    done: done(w.localDate),
  }));

  return { current, longest, week };
}

/** Section 4: the activity calendar for Lifetime Plus. */
export function calendarGrid(
  totals: Map<string, DailyTotal>,
  days = 91,
  today = toLocalDate(),
): { localDate: string; count: number; level: 0 | 1 | 2 | 3 | 4 }[] {
  const values = [...totals.values()].map((d) => d.count).sort((a, b) => a - b);
  const p = (q: number) => values[Math.floor(values.length * q)] ?? 0;
  const t1 = p(0.25) || 1;
  const t2 = p(0.5) || 33;
  const t3 = p(0.75) || 100;

  return Array.from({ length: days }, (_, i) => {
    const localDate = addDays(today, -(days - 1 - i));
    const count = totals.get(localDate)?.count ?? 0;
    const level: 0 | 1 | 2 | 3 | 4 =
      count === 0 ? 0 : count <= t1 ? 1 : count <= t2 ? 2 : count <= t3 ? 3 : 4;
    return { localDate, count, level };
  });
}
