/**
 * What a day is. One definition, used by the engine and by every page that
 * reads its history.
 *
 * docs/SPEC.md §1: a day is the calendar date **on the device** at the moment of
 * the tap. Not UTC — `toISOString().slice(0, 10)` would roll the day over at
 * 5:30 AM in India, moving early-morning japa, which is when most of it happens,
 * into the previous day.
 */

/** `YYYY-MM-DD` in the device's own timezone. */
export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Parse a day key back to local midnight. Returns null if it is not one. */
export function fromDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  // Rejects 2026-02-30, which Date would happily roll into March.
  return dayKey(date) === key ? date : null;
}

/**
 * Step by whole days.
 *
 * Built from local calendar parts rather than by adding 86_400_000 ms, because
 * a day is not always that long: the clocks change, and adding milliseconds
 * across a DST boundary lands an hour early or late and can repeat or skip a
 * date entirely.
 */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function shiftKey(key: string, n: number): string | null {
  const d = fromDayKey(key);
  return d ? dayKey(addDays(d, n)) : null;
}

/** Whole days from `a` to `b`, by the calendar rather than by the clock. */
export function daysBetween(a: string, b: string): number | null {
  const from = fromDayKey(a);
  const to = fromDayKey(b);
  if (!from || !to) return null;
  // Compare at UTC noon so a DST shift cannot round the division the wrong way.
  const noon = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  return Math.round((noon(to) - noon(from)) / 86_400_000);
}
