import { z } from "zod";

/**
 * The sync wire format and its limits (docs/SPEC.md §7). Shared by the routes and
 * their tests; the client builds the same shape from its outbox.
 */

export const MAX_ENTRIES = 200;
export const MAX_COUNT = 10_000_000;
export const MAX_MS_PER_DAY = 86_400_000;

/**
 * The shared source every device's pre-sync history is uploaded under
 * (SPEC §6, revised). Reserved: no installation may sync as it.
 */
export const HISTORY_SOURCE = "local-history";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** An installation's own id. Never the reserved history source. */
const SourceId = z
  .string()
  .min(1)
  .max(128)
  .refine((s) => s !== HISTORY_SOURCE, "reserved source id");

export const SyncEntry = z.object({
  day: Day,
  naamId: z.string().min(1).max(120),
  c: z.number().int().min(0).max(MAX_COUNT),
  r: z.number().int().min(0).max(MAX_COUNT),
  s: z.number().int().min(0).max(MAX_MS_PER_DAY),
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type SyncEntry = z.infer<typeof SyncEntry>;

export const SyncRequest = z.object({
  sourceId: SourceId,
  /**
   * "device": this installation's own components.
   * "history": its records from before it first synced, written under the shared
   * history source. Acknowledged the same way; others are not returned for it.
   */
  kind: z.enum(["device", "history"]).default("device"),
  zone: z.string().max(64).optional(),
  offset: z.number().int().min(-840).max(840).optional(),
  entries: z.array(SyncEntry).max(MAX_ENTRIES),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

export const PullRequest = z.object({
  sourceId: SourceId,
  since: Day.optional(),
});

export type Totals = { c: number; r: number; s: number };
export type Ack = { key: string; version: number; confirmed: Totals };
export type Rejected = { key: string; reason: "clock" | "shape" | "sources" };
export type OtherKind = "devices" | "history";
export type OtherRow = { day: string; naamId: string; kind: OtherKind } & Totals;
export type SyncResponse = { acks: Ack[]; rejected: Rejected[]; others: OtherRow[] };

export const keyOf = (day: string, naamId: string) => `${day}|${naamId}`;

/** A UTC calendar date, offset by whole days and years. */
function utcDate(now: Date, days = 0, years = 0): string {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * What to write and what to hand back refused.
 *
 * The database enforces the clock clamp too, but one bad row would fail the
 * whole upsert. Checking first means a phone with a wrong clock still syncs its
 * good days, and the bad ones come back as rejected so the client stops
 * resending them forever. The same key twice in one request keeps the higher
 * version.
 */
export function planSync(entries: SyncEntry[], now: Date = new Date()): { valid: SyncEntry[]; rejected: Rejected[] } {
  const latest = utcDate(now, 1);
  const earliest = utcDate(now, 0, -5);
  const byKey = new Map<string, SyncEntry>();
  const rejected: Rejected[] = [];

  for (const e of entries) {
    const key = keyOf(e.day, e.naamId);
    // A string that looks like a date but is not one (2026-02-31).
    const parsed = new Date(`${e.day}T00:00:00Z`);
    const real = !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === e.day;
    if (!real || e.r > e.c) {
      rejected.push({ key, reason: "shape" });
      continue;
    }
    if (e.day > latest || e.day < earliest) {
      rejected.push({ key, reason: "clock" });
      continue;
    }
    const held = byKey.get(key);
    if (!held || e.version > held.version) byKey.set(key, e);
  }

  return { valid: [...byKey.values()], rejected };
}

/** A database row from sync_others, in wire shape. */
export function toOtherRow(r: { day: string; naam_id: string; kind: string; count: number; rounds: number; ms: number }): OtherRow {
  return {
    day: r.day,
    naamId: r.naam_id,
    kind: r.kind === "history" ? "history" : "devices",
    c: r.count,
    r: r.rounds,
    s: r.ms,
  };
}
