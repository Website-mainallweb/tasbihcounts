/**
 * Number and text formatting.
 * Specification sections 16 (thousand separators) and 110 (locale numerals).
 *
 * The separator request came directly from a Play Store review of a one-million
 * install app: "needs a COMMA between each three digits". Nobody in the market
 * does it. See docs/design-research.md section 12.4.
 */

import type { NumeralStyle } from "./types";

const EASTERN = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** Group digits for readability, respecting the locale's own grouping rules. */
export function formatCount(
  n: number,
  locale = "en",
  numerals: NumeralStyle = "latin",
): string {
  const safe = Number.isFinite(n) ? Math.trunc(n) : 0;

  if (numerals === "arabic-indic") {
    // Grouped in the Latin sense first, then transliterated digit by digit so
    // the grouping separator stays predictable across engines.
    const grouped = new Intl.NumberFormat("en-US").format(safe);
    return grouped.replace(/[0-9]/g, (d) => EASTERN[Number(d)] ?? d);
  }

  try {
    return new Intl.NumberFormat(locale).format(safe);
  } catch {
    return new Intl.NumberFormat("en-US").format(safe);
  }
}

/** Short form for dense places such as a stat tile: 12.4k, 1.2M. */
export function formatCompact(n: number, locale = "en"): string {
  try {
    return new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return String(n);
  }
}

/** mm:ss, or h:mm:ss past an hour. Used by timed mode and the session clock. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = `${m}`.padStart(2, "0");
  const ss = `${sec}`.padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Section 21: a custom target accepts at least seven digits.
 * Requested in the wild as "2 lakh like 200000", and the jap market advertises
 * goals of one lakh and one crore.
 */
export const MAX_TARGET = 9_999_999;
export const MIN_TARGET = 1;

export function normaliseTarget(raw: string | number): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return clamp(Math.trunc(n), MIN_TARGET, MAX_TARGET);
}

/** Percentage 0 to 100 with no division by zero. */
export function progressPercent(count: number, target: number | null): number {
  if (!target || target <= 0) return 0;
  return clamp((count / target) * 100, 0, 100);
}

/** Diacritic and case insensitive key for the dhikr search (section 32). */
export function searchKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
