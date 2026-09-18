/**
 * A per-key request limit, in memory (docs/SECURITY.md §5).
 *
 * The debounced counter sends a handful of syncs a day. Anything sending dozens
 * a minute is not the counter, and the limit protects the bill as much as the
 * data. In memory is enough for one Node process, which is how the site runs;
 * it resets on restart, which errs on the side of letting a real user through.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let sweeps = 0;

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  // Drop expired buckets now and then, so the map cannot grow without end.
  if (++sweeps % 500 === 0) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear();
  sweeps = 0;
}
