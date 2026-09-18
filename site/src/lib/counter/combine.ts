import type { DayRec, NameRec } from "./storage";

/**
 * The whole practice, from this device's own history plus what everyone else
 * contributed (docs/ARCHITECTURE.md §1, docs/SPEC.md §6 revised).
 *
 * Three sources, three rules:
 *
 *   hist      this installation's own record — the thing it counts and uploads
 *   history   the shared pre-sync history every device uploaded once, cached from
 *             the server. It may contain THIS device's own old days, so it is
 *             COMPARED with hist (the larger wins), never added to it.
 *   devices   every other installation's own component, cached from the server.
 *             ADDED to the result.
 *
 * Keeping them apart is what stops a device showing — or, worse, uploading —
 * someone else's taps as its own, or its own old days twice.
 *
 * Everything shown — today, the streak, stats, lifetime — reads the combined
 * view. Everything uploaded reads `hist` alone.
 */

export type NameMap = Record<string, Record<string, NameRec>>;
export type Others = { devices: NameMap; history: NameMap };

type OtherRow = { day: string; naamId: string; kind: "devices" | "history"; c: number; r: number; s: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const n = (v: unknown) => {
  const x = Math.floor(Number(v));
  return Number.isFinite(x) && x > 0 ? x : 0;
};

export const emptyOthers = (): Others => ({ devices: {}, history: {} });

function readMap(raw: unknown): NameMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: NameMap = {};
  for (const [day, names] of Object.entries(raw as Record<string, unknown>)) {
    if (!DAY.test(day) || !names || typeof names !== "object" || Array.isArray(names)) continue;
    for (const [id, rec] of Object.entries(names as Record<string, unknown>)) {
      if (!rec || typeof rec !== "object") continue;
      const r = rec as Record<string, unknown>;
      (out[day] ??= {})[id] = { c: n(r.c), r: n(r.r), s: n(r.s) };
    }
  }
  return out;
}

/** Coerce a stored value into a usable pair of maps. */
export function readOthers(raw: unknown): Others {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyOthers();
  const o = raw as Record<string, unknown>;
  return { devices: readMap(o.devices), history: readMap(o.history) };
}

/**
 * Apply what the server reported. The server's sums are authoritative for the
 * days they cover, so those days are replaced outright in both maps — a name that
 * has gone from the reply has no count there any more. Days outside `scope` are
 * left as they were.
 */
export function mergeOthers(current: Others, rows: OtherRow[], scope: string[] | "all"): Others {
  const next: Others =
    scope === "all" ? emptyOthers() : { devices: { ...current.devices }, history: { ...current.history } };
  if (scope !== "all") {
    for (const day of scope) {
      delete next.devices[day];
      delete next.history[day];
    }
  }
  for (const row of rows) {
    if (!DAY.test(row.day)) continue;
    const map = row.kind === "history" ? next.history : next.devices;
    (map[row.day] ??= {})[row.naamId] = { c: n(row.c), r: n(row.r), s: n(row.s) };
  }
  return next;
}

const zero = (): NameRec => ({ c: 0, r: 0, s: 0 });
const add = (a: NameRec, b: NameRec): NameRec => ({ c: a.c + b.c, r: a.r + b.r, s: a.s + b.s });
const larger = (a: NameRec, b: NameRec): NameRec => ({ c: Math.max(a.c, b.c), r: Math.max(a.r, b.r), s: Math.max(a.s, b.s) });

/** Per-name records for a day. A day saved before names were tracked has one lump. */
function namesOf(rec: DayRec | undefined): Record<string, NameRec> {
  if (!rec) return {};
  if (rec.n) {
    return Object.fromEntries(Object.entries(rec.n).map(([id, v]) => [id, { c: n(v.c), r: n(v.r), s: n(v.s) }]));
  }
  return {};
}

/** This device's history with everyone else's counts folded in. */
export function combinedHistory(hist: Record<string, DayRec> | undefined, others: Others): Record<string, DayRec> {
  const days = new Set([...Object.keys(hist ?? {}), ...Object.keys(others.devices), ...Object.keys(others.history)]);
  const out: Record<string, DayRec> = {};

  for (const day of days) {
    const local = hist?.[day];
    const own = namesOf(local);
    const shared = others.history[day] ?? {};
    const elsewhere = others.devices[day] ?? {};

    const ids = new Set([...Object.keys(own), ...Object.keys(shared), ...Object.keys(elsewhere)]);
    const names: Record<string, NameRec> = {};
    for (const id of ids) {
      names[id] = add(larger(own[id] ?? zero(), shared[id] ?? zero()), elsewhere[id] ?? zero());
    }

    // A day with no per-name breakdown keeps its lump as the local part.
    let total = Object.values(names).reduce(add, zero());
    if (local && !local.n) {
      const lump: NameRec = { c: n(local.c), r: n(local.r), s: n(local.s) };
      const sharedTotal = Object.values(shared).reduce(add, zero());
      const elsewhereTotal = Object.values(elsewhere).reduce(add, zero());
      total = add(larger(lump, sharedTotal), elsewhereTotal);
    }

    out[day] = { ...total, ...(Object.keys(names).length ? { n: names } : {}) };
  }

  return out;
}

/** How much the combined view adds to this device's own lifetime total. */
export function extraLifetime(hist: Record<string, DayRec> | undefined, others: Others): number {
  const combined = combinedHistory(hist, others);
  let extra = 0;
  for (const [day, rec] of Object.entries(combined)) extra += rec.c - n(hist?.[day]?.c);
  return Math.max(0, extra);
}
