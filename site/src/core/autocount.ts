/**
 * Auto-count, the pace mode.
 * Specification section 24C, added by the competitive research.
 *
 * Source: an eTasbih review with 177 helpful votes described exactly this and
 * it was the single most appreciated feature found in the entire teardown:
 *
 *   "allows you to record ten tasbihs with tapping the app, then it
 *    automatically begins to count at that pace for you so you can keep
 *    reading hands-free ... great when you need your hands free, in the car"
 *
 * A second review asked for adjustable speed from 0.5x. Both are implemented.
 *
 * This is the user's own tool for their own practice. An auto-advancing count
 * carries no religious claim whatsoever (section 21).
 */

import { clamp } from "./format";

/** Taps sampled before a pace can be offered. */
export const LEARN_TAPS = 10;

/** Guard rails so a stray double tap cannot produce a runaway pace. */
export const MIN_INTERVAL_MS = 250;
export const MAX_INTERVAL_MS = 10_000;

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type Speed = (typeof SPEEDS)[number];

export interface PaceLearner {
  /** Timestamps of recent taps, most recent last. */
  taps: number[];
}

export function createLearner(): PaceLearner {
  return { taps: [] };
}

export function recordTap(learner: PaceLearner, at = Date.now()): PaceLearner {
  const taps = [...learner.taps, at];
  // Keep a little more than the learning window so the median stays stable.
  return { taps: taps.slice(-(LEARN_TAPS + 4)) };
}

export function resetLearner(): PaceLearner {
  return { taps: [] };
}

export function tapsLearned(learner: PaceLearner): number {
  return Math.max(0, learner.taps.length - 1);
}

export function canOfferPace(learner: PaceLearner): boolean {
  return tapsLearned(learner) >= LEARN_TAPS;
}

/**
 * The median gap, not the mean. One long pause while the user settles should
 * not drag the whole pace out, and the median ignores it.
 */
export function learnedIntervalMs(learner: PaceLearner): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < learner.taps.length; i += 1) {
    const a = learner.taps[i - 1];
    const b = learner.taps[i];
    if (a === undefined || b === undefined) continue;
    const gap = b - a;
    if (gap >= MIN_INTERVAL_MS && gap <= MAX_INTERVAL_MS) gaps.push(gap);
  }
  if (gaps.length < 3) return null;

  gaps.sort((x, y) => x - y);
  const mid = Math.floor(gaps.length / 2);
  const median =
    gaps.length % 2 === 0
      ? ((gaps[mid - 1] ?? 0) + (gaps[mid] ?? 0)) / 2
      : (gaps[mid] ?? 0);

  return Math.round(clamp(median, MIN_INTERVAL_MS, MAX_INTERVAL_MS));
}

export function applySpeed(intervalMs: number, speed: Speed): number {
  return Math.round(clamp(intervalMs / speed, MIN_INTERVAL_MS, MAX_INTERVAL_MS));
}

/** Human label for the control, e.g. "about 1.4 per second". */
export function paceLabel(intervalMs: number, locale = "en"): string {
  const perMinute = Math.round(60_000 / intervalMs);
  try {
    return `${new Intl.NumberFormat(locale).format(perMinute)} / min`;
  } catch {
    return `${perMinute} / min`;
  }
}
