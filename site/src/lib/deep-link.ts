"use client";

/**
 * The result of reading a deep link, kept in its own module.
 *
 * WHY THIS IS NOT IN CounterTool
 * It was, briefly, and it broke the entire counter. `CounterTool` renders
 * `StatusBar`, and `StatusBar` needed to read what the deep link had missed —
 * so it imported from `CounterTool`, which imports `StatusBar`. Webpack
 * resolves that cycle by handing one of them a half-initialised module, and the
 * counter stopped responding to taps with no error anywhere obvious.
 *
 * Found by device testing: the consent banner mounted, so React was clearly
 * alive, but the number would not move.
 *
 * A shared value that two components both need belongs to neither of them.
 */

/** Set when a URL named a dhikr or routine that does not exist. */
let miss: string | null = null;

/**
 * Subscribers, because polling for this does not work.
 *
 * The status line first read the value once, on a 400ms timer. The miss is set
 * by `openDeepLink`, which runs only after the counter has hydrated — reading
 * IndexedDB, sealing stale sessions and rolling up totals — and on a cold load
 * that is comfortably past 400ms. So the read almost always happened first, got
 * null, and the reader was never told their link named nothing.
 *
 * A one-shot read of a value that is written later is a race with no winner.
 */
type Listener = (value: string) => void;
const listeners = new Set<Listener>();

export function setDeepLinkMiss(value: string | null): void {
  miss = value;
  if (!value) return;
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {
      /* a listener must never break the counter */
    }
  }
}

/**
 * Watch for a miss. Fires immediately if one was already recorded — which
 * covers the opposite race, where the deep link is read before the status line
 * has mounted.
 */
export function onDeepLinkMiss(listener: Listener): () => void {
  listeners.add(listener);
  if (miss) listener(miss);
  return () => listeners.delete(listener);
}

/** Read and clear, so the notice does not reappear on a later mount. */
export function takeDeepLinkMiss(): string | null {
  const value = miss;
  miss = null;
  return value;
}
