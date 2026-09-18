/**
 * What this installation still owes the server, and what the server has already
 * confirmed.
 *
 * There is no server yet — that is Phase 8. This exists now because it lives in
 * the same localStorage blob as everything else, and changing the stored shape
 * later is the expensive kind of change. It also has one job today: deciding
 * when undo is still allowed.
 *
 * The model is docs/ARCHITECTURE.md §1. This installation counts only its own
 * contribution, uploads that absolute number rather than a delta, and the server
 * merges with GREATEST per source. Two rules follow and both are enforced here:
 *
 *   - an entry is keyed by day and name, never a single "pending" record, so a
 *     day boundary or a name switch cannot overwrite work that has not gone out
 *   - a component never decreases, or GREATEST would resurrect what was undone
 */

export type OutboxKey = string;

export type Component = {
  /** Taps this installation contributed. */
  c: number;
  /** Rounds (malas) completed. */
  r: number;
  /** Time on the mala, in milliseconds — the engine accumulates Date.now() deltas. */
  s: number;
};

export type Entry = Component & {
  day: string;
  naamId: string;
  /** Bumped on every change, so an acknowledgement of an older value is ignored. */
  version: number;
};

export type Outbox = Record<OutboxKey, Entry>;
/** The last values the server confirmed, per key. */
export type Watermark = Record<OutboxKey, Component>;

export const keyOf = (day: string, naamId: string): OutboxKey => `${day}|${naamId}`;

const ZERO: Component = { c: 0, r: 0, s: 0 };

const num = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Coerce whatever came out of storage into a usable outbox. */
export function readOutbox(raw: unknown): Outbox {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Outbox = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    if (typeof e.day !== "string" || typeof e.naamId !== "string") continue;
    out[k] = {
      day: e.day,
      naamId: e.naamId,
      c: num(e.c),
      r: num(e.r),
      s: num(e.s),
      version: num(e.version),
    };
  }
  return out;
}

export function readWatermark(raw: unknown): Watermark {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Watermark = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    out[k] = { c: num(e.c), r: num(e.r), s: num(e.s) };
  }
  return out;
}

/**
 * Record this installation's current contribution for a day and name.
 *
 * The value is absolute, not a delta — a retried request must be able to arrive
 * twice without counting twice.
 */
export function mark(
  outbox: Outbox,
  day: string,
  naamId: string,
  value: Component,
): Outbox {
  const k = keyOf(day, naamId);
  const prev = outbox[k];
  const next: Entry = {
    day,
    naamId,
    // The value as it is now, even when lower. The only thing that lowers it is an
    // undo, and canUndo() allows that only above what the server confirmed — so
    // what goes down here was never sent. Keeping the higher value instead would
    // upload a tap the user had taken back.
    c: num(value.c),
    r: num(value.r),
    s: num(value.s),
    version: (prev?.version ?? 0) + 1,
  };
  if (prev && prev.c === next.c && prev.r === next.r && prev.s === next.s) {
    return outbox; // nothing moved; do not churn the version
  }
  return { ...outbox, [k]: next };
}

/** Entries still owed to the server. */
export function pending(outbox: Outbox): Entry[] {
  return Object.values(outbox);
}

export function isEmpty(outbox: Outbox): boolean {
  return Object.keys(outbox).length === 0;
}

export type Ack = { key: OutboxKey; version: number; confirmed: Component };

/**
 * Apply what the server confirmed.
 *
 * An entry clears only when the acknowledgement names the version that was sent.
 * If the user kept tapping while the request was in flight the entry is newer
 * than the reply, so it stays dirty and goes again — the alternative is
 * forgetting taps that were never uploaded.
 */
export function acknowledge(
  outbox: Outbox,
  watermark: Watermark,
  acks: Ack[],
): { outbox: Outbox; watermark: Watermark } {
  const nextOutbox = { ...outbox };
  const nextMark = { ...watermark };

  for (const ack of acks) {
    const held = nextMark[ack.key] ?? ZERO;
    // The watermark only ever rises: a reply that arrives out of order must not
    // walk it backwards and re-enable an undo that is no longer safe.
    nextMark[ack.key] = {
      c: Math.max(held.c, num(ack.confirmed.c)),
      r: Math.max(held.r, num(ack.confirmed.r)),
      s: Math.max(held.s, num(ack.confirmed.s)),
    };

    const entry = nextOutbox[ack.key];
    if (entry && entry.version === ack.version) delete nextOutbox[ack.key];
  }

  return { outbox: nextOutbox, watermark: nextMark };
}

/**
 * How many taps may still be undone for this day and name.
 *
 * Anything the server has confirmed is permanent: lowering a component below the
 * watermark would be undone locally and then resurrected by GREATEST on the next
 * sync — the tap would come back, which is worse than not undoing at all.
 *
 * With no server, the watermark is empty and everything is undoable, which is
 * exactly today's behaviour.
 */
export function undoableCount(
  watermark: Watermark,
  day: string,
  naamId: string,
  current: number,
): number {
  const held = watermark[keyOf(day, naamId)];
  return Math.max(0, num(current) - (held?.c ?? 0));
}

export function canUndo(
  watermark: Watermark,
  day: string,
  naamId: string,
  current: number,
): boolean {
  return undoableCount(watermark, day, naamId, current) > 0;
}
