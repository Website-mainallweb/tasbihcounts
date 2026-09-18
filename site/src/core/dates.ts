/**
 * The ONLY module allowed to derive a calendar day.
 * Specification sections 12.3, 29, 30.
 *
 * Rule: a calendar day is always the device's local day, never derived from a
 * UTC timestamp. A user who travels must never lose a streak, and two devices
 * in two time zones each write their own honest localDate.
 */

/** YYYY-MM-DD for the device's local calendar day. */
export function toLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Minutes offset from UTC at the given instant, positive east of Greenwich. */
export function tzOffsetMinutes(d: Date = new Date()): number {
  return -d.getTimezoneOffset();
}

export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(s: string, n: number): string {
  const d = parseLocalDate(s);
  d.setDate(d.getDate() + n);
  return toLocalDate(d);
}

export function daysBetween(a: string, b: string): number {
  const ms = parseLocalDate(b).getTime() - parseLocalDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function isToday(s: string): boolean {
  return s === toLocalDate();
}

/** Milliseconds until the next local midnight, for the rollover timer. */
export function msUntilLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

/** Local 23:59:59.999 of the given day, used when sealing across midnight. */
export function endOfLocalDay(localDate: string): number {
  const d = parseLocalDate(localDate);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * The seven days ending today, ordered oldest first and aligned to the week
 * start for the locale. Section 30.2: the week does not always start on Monday.
 */
export function weekWindow(
  locale = "en",
  today: string = toLocalDate(),
): { localDate: string; label: string; isToday: boolean }[] {
  const weekStart = weekStartsOn(locale);
  const t = parseLocalDate(today);
  const shift = (t.getDay() - weekStart + 7) % 7;
  const first = addDays(today, -shift);

  const fmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(first, i);
    return {
      localDate: date,
      label: fmt.format(parseLocalDate(date)),
      isToday: date === today,
    };
  });
}

/** 0 = Sunday, 1 = Monday, 6 = Saturday. */
export function weekStartsOn(locale: string): number {
  // Intl.Locale.getWeekInfo is not available everywhere yet, so fall back.
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info?.firstDay) return info.firstDay % 7; // 7 means Sunday
  } catch {
    /* fall through */
  }
  const sundayFirst = ["en", "ar", "ur", "he", "id", "ms", "hi", "bn"];
  const base = locale.split("-")[0] ?? "en";
  return sundayFirst.includes(base) ? 0 : 1;
}

export function formatDayLong(localDate: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(parseLocalDate(localDate));
}
