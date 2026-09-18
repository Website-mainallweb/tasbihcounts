import { SYNCED_KEY, type Storage } from "./storage";

/**
 * When this device last reached the account (UX walkthrough #21).
 *
 * Sync is silent by design — nothing on the counter should interrupt a chant to
 * announce a successful upload — but silence and a broken sync look identical,
 * and the account page was the natural place to ask "is my practice up there?".
 *
 * One timestamp, written by the engine whenever the server answers, read by the
 * account page. It is per device on purpose: the question is whether THIS phone
 * is reaching the account, so a time from another device would answer the wrong
 * question.
 */

export { SYNCED_KEY };

/** A successful round trip — an upload the server answered, or a pull. */
export function markSynced(store: Storage, at: number = Date.now()): void {
  store.setItem(SYNCED_KEY, String(at));
}

/** Null when this device has never reached the account, or the clock is absurd. */
export function readSynced(store: Storage, now: number = Date.now()): number | null {
  const raw = store.getItem(SYNCED_KEY);
  if (!raw) return null;
  const at = Number(raw);
  // A future stamp means a clock that has since been corrected; treat it as now
  // rather than showing "in 3 hours".
  if (!Number.isFinite(at) || at <= 0) return null;
  return at > now ? now : at;
}

export function clearSynced(store: Storage): void {
  store.removeItem(SYNCED_KEY);
}

/**
 * How long ago, in words. Coarse on purpose: the reader wants "recently" or
 * "something is wrong", not a stopwatch.
 */
export function agoLabel(at: number, now: number = Date.now()): string {
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins === 1 ? "a minute ago" : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
