/**
 * When a reminder is due. Pure, so it is tested across time zones without
 * waiting for 9 PM anywhere.
 *
 * The scheduler runs every 15 minutes. A reminder is due in the first run whose
 * time falls in [remind_at, remind_at + window) on the user's local clock, and
 * only if nothing was already sent — or deliberately skipped — for that local day.
 */

export const WINDOW_MINUTES = 15;

export type ReminderRow = {
  userId: string;
  zone: string;
  /** Minutes after local midnight. */
  remindAt: number;
  lastSentDay: string | null;
};

/** The calendar day (YYYY-MM-DD) and minute of the day at `now` in `zone`. */
export function localClock(now: Date, zone: string): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minute: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function isDue(row: ReminderRow, now: Date, windowMinutes = WINDOW_MINUTES): { due: boolean; day: string } {
  let clock: { day: string; minute: number };
  try {
    clock = localClock(now, row.zone);
  } catch {
    // A zone Intl does not know. The database refuses those, so this is a guard
    // against a future change, not a path that should happen.
    return { due: false, day: "" };
  }
  const inWindow = clock.minute >= row.remindAt && clock.minute < row.remindAt + windowMinutes;
  return { due: inWindow && row.lastSentDay !== clock.day, day: clock.day };
}
