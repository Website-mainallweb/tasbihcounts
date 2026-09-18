/**
 * The history, added up.
 *
 * Two things can be measured — chants and time on the mala — over three grains,
 * for one name or all of them. Everything is derived from the day records on
 * demand; nothing is cached and nothing is stored, so a total can never drift
 * away from the days behind it.
 */

import { dayKey, daysBetween, fromDayKey, shiftKey } from "./day";
import type { DayRec, NameRec } from "./storage";

/** The first day with anything recorded, or null. Averages start there, not before. */
export function firstRecordedDay(hist: Record<string, DayRec>): string | null {
  let first: string | null = null;
  for (const [k, rec] of Object.entries(hist)) {
    if (rec && ((rec.c || 0) > 0 || (rec.s || 0) > 0) && (first === null || k < first)) first = k;
  }
  return first;
}

export type History = Record<string, DayRec>;

/** Chants, or milliseconds on the mala. */
export type Metric = "count" | "time";
export type Grain = "daily" | "monthly" | "yearly";

/** `null` means every name together. */
export type NameFilter = string | null;

export type Bucket = {
  /** A day key, `YYYY-MM`, or a year. */
  key: string;
  label: string;
  value: number;
  /** The bucket the present falls in. */
  isNow: boolean;
};

export type Period = {
  grain: Grain;
  label: string;
  buckets: Bucket[];
  total: number;
  /** Per day across the days the period actually covers, not per bucket. */
  perDay: number;
  /** Buckets with something in them. */
  activeBuckets: number;
  /**
   * True when a name filter is on and some days in range predate the per-name
   * breakdown, so their chants cannot be attributed and are not counted here.
   */
  unattributed: boolean;
};

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** What one day contributes, once the filter has been applied. */
function valueOf(rec: DayRec | undefined, metric: Metric, name: NameFilter): number {
  if (!rec) return 0;
  const src: NameRec | undefined = name === null ? rec : rec.n?.[name];
  if (!src) return 0;
  return (metric === "count" ? src.c : src.s) || 0;
}

/** A day counted toward a name but has no breakdown to prove it. */
function isUnattributed(rec: DayRec | undefined, name: NameFilter): boolean {
  return name !== null && !!rec && !rec.n && (rec.c > 0 || rec.s > 0);
}

/** Every name that appears anywhere in the history, most-chanted first. */
export function namesInHistory(hist: History): { id: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const rec of Object.values(hist)) {
    for (const [id, n] of Object.entries(rec.n ?? {})) {
      totals.set(id, (totals.get(id) ?? 0) + (n.c || 0));
    }
  }
  return [...totals.entries()]
    .map(([id, total]) => ({ id, total }))
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}

/** Whether any day at all carries a breakdown — the filter is useless without one. */
export function hasNameBreakdown(hist: History): boolean {
  return Object.values(hist).some((r) => r.n && Object.keys(r.n).length > 0);
}

function weekOf(today: string, offset: number): string[] {
  const parsed = fromDayKey(today);
  if (!parsed) return [];
  const backToMonday = (parsed.getDay() + 6) % 7;
  const monday = shiftKey(today, -backToMonday + offset * 7);
  if (!monday) return [];
  return Array.from({ length: 7 }, (_, i) => shiftKey(monday, i)!).filter(Boolean);
}

function fmtDay(key: string): string {
  const d = fromDayKey(key);
  return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` : key;
}

/**
 * One period's worth of buckets.
 *
 * `offset` steps backwards through time: 0 is the week, year or span containing
 * today, -1 the one before it.
 */
export function buildPeriod(
  hist: History,
  opts: {
    grain: Grain;
    metric: Metric;
    name?: NameFilter;
    offset?: number;
    today?: string;
  },
): Period {
  const { grain, metric } = opts;
  const name = opts.name ?? null;
  const offset = opts.offset ?? 0;
  const today = opts.today ?? dayKey();

  let buckets: Bucket[] = [];
  let label = "";
  let dayKeys: string[] = [];
  /* The calendar span of the period, for the average below. */
  let start = today;
  let finish = today;
  const first = firstRecordedDay(hist);

  if (grain === "daily") {
    const days = weekOf(today, offset);
    dayKeys = days;
    if (days.length === 7) [start, finish] = [days[0], days[6]];
    buckets = days.map((key, i) => ({
      key,
      label: WEEKDAYS_SHORT[i],
      value: valueOf(hist[key], metric, name),
      isNow: key === today,
    }));
    label =
      days.length === 7 ? `${fmtDay(days[0])} – ${fmtDay(days[6])}` : "";
  } else if (grain === "monthly") {
    const year = (fromDayKey(today)?.getFullYear() ?? 2026) + offset;
    [start, finish] = [`${year}-01-01`, `${year}-12-31`];
    label = String(year);
    buckets = MONTHS_SHORT.map((m, i) => {
      const prefix = `${year}-${String(i + 1).padStart(2, "0")}`;
      let value = 0;
      for (const [k, rec] of Object.entries(hist)) {
        if (k.startsWith(prefix)) {
          value += valueOf(rec, metric, name);
          dayKeys.push(k);
        }
      }
      return { key: prefix, label: m, value, isNow: today.startsWith(prefix) };
    });
  } else {
    // Yearly: up to five years ending with the one in view, but none before the
    // first year anything was recorded — a new user saw four empty years (#34).
    const end = (fromDayKey(today)?.getFullYear() ?? 2026) + offset;
    const firstYear = first ? Number(first.slice(0, 4)) : end;
    const from = Math.max(end - 4, Math.min(firstYear, end));
    [start, finish] = [`${from}-01-01`, `${end}-12-31`];
    label = from === end ? String(end) : `${from} – ${end}`;
    buckets = Array.from({ length: end - from + 1 }, (_, i) => {
      const y = String(from + i);
      let value = 0;
      for (const [k, rec] of Object.entries(hist)) {
        if (k.startsWith(y)) {
          value += valueOf(rec, metric, name);
          dayKeys.push(k);
        }
      }
      return { key: y, label: y, value, isNow: today.startsWith(y) };
    });
  }

  const total = buckets.reduce((n, b) => n + b.value, 0);

  /*
   * Averaged over the calendar days that have actually happened in the period,
   * counted from the first recorded day — one rule for every grain. Dividing
   * this week's total by seven on a Tuesday understates the practice by more
   * than half; and monthly and yearly used to divide by the days that HAD a
   * record, which is "per practised day" wearing the label "a day" (#06).
   */
  const from = first !== null && first > start ? first : start;
  const to = today < finish ? today : finish;
  const spanDays = first !== null && from <= to ? (daysBetween(from, to) ?? 0) + 1 : 1;

  return {
    grain,
    label,
    buckets,
    total,
    perDay: Math.round(total / Math.max(1, spanDays)),
    activeBuckets: buckets.filter((b) => b.value > 0).length,
    unattributed: dayKeys.some((k) => isUnattributed(hist[k], name)),
  };
}

/**
 * Is there anything before the period in view (B47)? Paging back used to go on
 * forever through empty weeks and years.
 */
export function canGoBack(hist: History, grain: Grain, offset: number, today: string): boolean {
  const first = firstRecordedDay(hist);
  if (!first) return false;
  const year = (fromDayKey(today)?.getFullYear() ?? 2026) + offset;
  const firstYear = Number(first.slice(0, 4));
  if (grain === "daily") {
    const days = weekOf(today, offset);
    return days.length === 7 && days[0] > first;
  }
  if (grain === "monthly") return year > firstYear;
  return year - 4 > firstYear;
}

/** Can the view step forward from here, or is that the future? */
export function canGoForward(offset: number): boolean {
  return offset < 0;
}

/** Milliseconds as something a person reads. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours)}h`;
}

export function formatValue(value: number, metric: Metric): string {
  return metric === "time"
    ? formatDuration(value)
    : value.toLocaleString("en-IN");
}
