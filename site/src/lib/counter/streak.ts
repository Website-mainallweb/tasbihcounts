/**
 * Streaks, derived from the day records and never stored.
 *
 * docs/SPEC.md §3: **a day counts when the user completed their own target on
 * it** — `rec.r >= 1`, the round counter the engine increments at every target
 * boundary. Not one tap, which would make the streak unbreakable and therefore
 * meaningless; and not a fixed 108, which would punish a practice of 21 and
 * flatter one of 1008.
 *
 * Judged against the target that was in force on the day itself, because `rec.r`
 * was written then. Raising the target today does not retroactively take away
 * days already earned.
 *
 * Nothing here is stored. A stored streak is a second copy of a fact, free to
 * drift away from the days it claims to summarise.
 */

import { dayKey, daysBetween, shiftKey } from "./day";
import type { DayRec } from "./storage";

export type History = Record<string, DayRec>;

/** Did this day earn its place in the streak? */
export function qualifies(rec: DayRec | undefined): boolean {
  return !!rec && (rec.r || 0) >= 1;
}

/** Every qualifying day, oldest first. */
export function qualifyingDays(hist: History): string[] {
  return Object.keys(hist)
    .filter((k) => qualifies(hist[k]))
    .sort();
}

/**
 * The run the user is currently on.
 *
 * A streak does not break the moment midnight passes. Until today is over there
 * is still time to practise, so a run that reached yesterday is alive and is
 * counted — the number simply does not include today yet. Anything older than
 * yesterday has genuinely lapsed.
 */
export function currentStreak(hist: History, today: string = dayKey()): number {
  let cursor = qualifies(hist[today]) ? today : shiftKey(today, -1);
  if (!cursor || !qualifies(hist[cursor])) return 0;

  let n = 0;
  while (cursor && qualifies(hist[cursor])) {
    n++;
    cursor = shiftKey(cursor, -1);
  }
  return n;
}

/** The longest run there has ever been, including one still in progress. */
export function bestStreak(hist: History): number {
  const days = qualifyingDays(hist);
  if (days.length === 0) return 0;

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = daysBetween(days[i - 1], days[i]) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * `open` is today while its target is not yet met — there is still time, so it is
 * not a miss. `before` is a day before the practice began: nothing was missed on a
 * day nobody had started yet. Both used to read ✕ "missed", which greeted a new
 * user with a row of crosses (UX walkthrough #05).
 */
export type DayState = "done" | "missed" | "open" | "before" | "future";

/** The first day anything was counted, or null for a practice not yet begun. */
export function firstPracticeDay(hist: History): string | null {
  let first: string | null = null;
  for (const [k, rec] of Object.entries(hist)) {
    if (rec && (rec.c || 0) > 0 && (first === null || k < first)) first = k;
  }
  return first;
}

function stateOf(hist: History, key: string, today: string, first: string | null): DayState {
  if (qualifies(hist[key])) return "done";
  if ((daysBetween(today, key) ?? 0) > 0) return "future";
  if (key === today) return "open";
  if (first === null || key < first) return "before";
  return "missed";
}

export type WeekDay = {
  key: string;
  /** 0 = Sunday, matching Date.getDay(). */
  weekday: number;
  state: DayState;
  isToday: boolean;
};

/**
 * The seven days of the week `today` falls in, starting on Monday.
 *
 * Monday because that is how the week reads to most people planning a practice,
 * and because a week that starts on Sunday puts the two quietest days at
 * opposite ends.
 */
export function weekStrip(hist: History, today: string = dayKey()): WeekDay[] {
  // getDay() is 0 for Sunday; shift so Monday is 0.
  const parsed = new Date(`${today}T00:00:00`);
  const offset = (parsed.getDay() + 6) % 7;
  const monday = shiftKey(today, -offset);
  if (!monday) return [];

  const first = firstPracticeDay(hist);
  const out: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const key = shiftKey(monday, i);
    if (!key) break;
    out.push({
      key,
      weekday: (i + 1) % 7,
      state: stateOf(hist, key, today, first),
      isToday: key === today,
    });
  }
  return out;
}

export type CalendarCell = WeekDay & { dayOfMonth: number };

export type CalendarMonth = {
  year: number;
  /** 1-12, so it reads the way people say it. */
  month: number;
  label: string;
  /** Blank cells before the first, so the grid lines up under its weekday row. */
  leading: number;
  cells: CalendarCell[];
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** One month laid out for a grid whose columns start on Monday. */
export function calendarMonth(
  hist: History,
  year: number,
  month: number,
  today: string = dayKey(),
): CalendarMonth {
  const first = new Date(year, month - 1, 1);
  const leading = (first.getDay() + 6) % 7;
  const dayCount = new Date(year, month, 0).getDate();

  const began = firstPracticeDay(hist);
  const cells: CalendarCell[] = [];
  for (let d = 1; d <= dayCount; d++) {
    const date = new Date(year, month - 1, d);
    const key = dayKey(date);
    cells.push({
      key,
      dayOfMonth: d,
      weekday: date.getDay(),
      state: stateOf(hist, key, today, began),
      isToday: key === today,
    });
  }

  return {
    year,
    month,
    label: `${MONTHS[month - 1]} ${year}`,
    leading,
    cells,
  };
}

export type StreakSummary = {
  current: number;
  best: number;
  /** Days that ever counted — a different question from the longest run. */
  totalDays: number;
  /** True while today is still unclaimed and a live run is riding on yesterday. */
  atRisk: boolean;
};

export function summarise(hist: History, today: string = dayKey()): StreakSummary {
  const current = currentStreak(hist, today);
  return {
    current,
    best: bestStreak(hist),
    totalDays: qualifyingDays(hist).length,
    atRisk: current > 0 && !qualifies(hist[today]),
  };
}
