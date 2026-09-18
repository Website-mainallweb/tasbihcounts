import { pending, readOutbox, type Entry } from "./outbox";
import {
  COLD_KEY,
  HOT_KEY,
  join,
  load,
  newSourceId,
  saveCold,
  saveHot,
  SYNCED_KEY,
  touchRev,
  type ColdBlob,
  type DayRec,
  type HotBlob,
  type State,
  type Storage,
} from "./storage";

/**
 * Whose practice this device is holding, and what signing in and out does to it
 * (decided with Rajan on 2026-09-11).
 *
 *   A free counter             its practice lives here and nowhere else.
 *   First sign-in, new account the account is empty (it was just bought): this
 *                              device's practice goes up and becomes the account's.
 *   First sign-in, old account the account already has a practice: that is what
 *                              shows. This device's own practice is NOT mixed in —
 *                              it is set aside here, untouched, and the user is
 *                              asked once whether to add it. Silently merging would
 *                              put a family member's or an old free counter's
 *                              chants into the account for good (counts only rise);
 *                              silently deleting would lose real practice.
 *   A different account        the previous account's practice is safe in its own
 *                              cloud; this device starts empty for the new one.
 *   Sign out                   whatever is still unsent goes up first. Then the
 *                              account's practice leaves the device and the device
 *                              gets back what it had before sign-in (the set-aside
 *                              practice, or nothing). The next person on a shared
 *                              phone sees none of the account.
 *
 * Settings — theme, language, target, mode and the like — belong to the device and
 * are never moved.
 *
 * Pure of the engine and the network, so all of it is tested with a memory store.
 */

export const STASH_KEY = "njc.stash";

/** What a practice is. Everything else in the state is a device setting. */
export const PRACTICE_KEYS = [
  "count",
  "malaDone",
  "lifetime",
  "hist",
  "custom",
  "favs",
  "nameId",
  "lastBackup",
  "importedBackups",
  "nudgedOn",
  "syncFrom",
  "historyUploaded",
  "others",
  "owner",
] as const;

export type Stash = { v: 1; at: number; hot: string | null; cold: string | null; askedOn?: string };

export type Decision =
  /** This device already holds this account's practice. */
  | "linked"
  /** Synced before owners were recorded: it is this account's. */
  | "adopt"
  /** It holds another account's practice. */
  | "switch"
  /** Nothing practised here yet: simply take the account's. */
  | "claim"
  /** A practice from before sign-in: whether it goes up depends on the cloud. */
  | "ask-cloud";

export function decide(state: State, userId: string): Decision {
  const owner = typeof state.owner === "string" ? state.owner : null;
  if (owner === userId) return "linked";
  if (owner) return "switch";
  if (typeof state.syncFrom === "string") return "adopt";
  return hasPractice(state) ? "ask-cloud" : "claim";
}

const days = (state: State) => (state.hist ?? {}) as Record<string, DayRec>;

export function chantsIn(state: State): number {
  let total = 0;
  for (const rec of Object.values(days(state))) total += Math.max(0, Math.floor(Number(rec?.c) || 0));
  return total;
}

export function hasPractice(state: State): boolean {
  return chantsIn(state) > 0 || Math.floor(Number(state.lifetime) || 0) > 0;
}

function settingsOf(state: State): State {
  const out: State = {};
  for (const [k, v] of Object.entries(state)) {
    if (!(PRACTICE_KEYS as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
}

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
};

/** An empty practice with this device's settings, under a new installation id. */
function writeEmpty(storage: Storage, settings: State, today: string, owner?: string): void {
  const state: State = {
    ...settings,
    count: 0,
    malaDone: 0,
    lifetime: 0,
    hist: {},
    custom: [],
    favs: [],
    nameId: null,
    lastDay: today,
    ...(owner ? { owner } : {}),
  };
  const sourceId = newSourceId();
  saveCold(storage, state, { sourceId });
  saveHot(storage, state, { sourceId, outbox: {}, watermark: {} });
  touchRev(storage);
}

export function readStash(storage: Storage): Stash | null {
  const s = parse<Stash>(storage.getItem(STASH_KEY));
  return s && s.v === 1 ? s : null;
}

/** The set-aside practice as a state, for "Add it to my account". */
export function stashedState(storage: Storage): State | null {
  const s = readStash(storage);
  if (!s) return null;
  return join(parse<HotBlob>(s.hot), parse<ColdBlob>(s.cold)).state;
}

export function markStashAsked(storage: Storage, today: string): void {
  const s = readStash(storage);
  if (s) storage.setItem(STASH_KEY, JSON.stringify({ ...s, askedOn: today }));
}

export function dropStash(storage: Storage): void {
  storage.removeItem(STASH_KEY);
}

/**
 * Old account: put this device's practice aside exactly as stored, and start
 * empty for the account. Returns false — and changes nothing — if the copy could
 * not be written, because wiping without a copy would lose the practice.
 */
export function setAside(storage: Storage, userId: string, today: string): boolean {
  const hot = storage.getItem(HOT_KEY);
  const cold = storage.getItem(COLD_KEY);
  if (!readStash(storage)) {
    const stash: Stash = { v: 1, at: Date.now(), hot, cold };
    const text = JSON.stringify(stash);
    storage.setItem(STASH_KEY, text);
    if (storage.getItem(STASH_KEY) !== text) return false;
  }
  writeEmpty(storage, settingsOf(load(storage).state), today, userId);
  return true;
}

/** Another account was signed in here: start empty for this one. Its own practice is in its cloud. */
export function startEmptyFor(storage: Storage, userId: string, today: string): void {
  writeEmpty(storage, settingsOf(load(storage).state), today, userId);
}

/**
 * Sign out: the account's practice leaves this device, which gets back what it had
 * before sign-in. Current settings are kept either way.
 */
export function leaveDevice(storage: Storage, today: string): void {
  const settings = settingsOf(load(storage).state);
  /* The device is no longer attached to an account, so "last synced" describes a
     link that no longer exists (#21). */
  storage.removeItem(SYNCED_KEY);
  const stash = readStash(storage);
  if (!stash) {
    writeEmpty(storage, settings, today);
    return;
  }
  const hot = parse<HotBlob>(stash.hot);
  const cold = parse<ColdBlob>(stash.cold);
  const restored: State = { ...join(hot, cold).state, ...settings, lastDay: today };
  delete restored.owner;
  const sourceId = hot?.sourceId || newSourceId();
  saveCold(storage, restored, { sourceId });
  saveHot(storage, restored, { sourceId, outbox: hot?.outbox ?? {}, watermark: hot?.watermark ?? {} });
  dropStash(storage);
  touchRev(storage);
}

/** Days recorded before this installation first synced, for the one-time history upload (SPEC §6). */
export function historyEntries(hist: Record<string, DayRec> | undefined, syncFrom: string): Entry[] {
  const out: Entry[] = [];
  for (const [day, rec] of Object.entries(hist ?? {})) {
    if (day >= syncFrom || !rec) continue;
    const cap = (v: number | undefined, max: number) => Math.min(Math.max(0, Math.floor(Number(v) || 0)), max);
    if (rec.n) {
      for (const [id, v] of Object.entries(rec.n)) {
        const c = cap(v.c, 10_000_000);
        if (c > 0) out.push({ day, naamId: id, c, r: Math.min(cap(v.r, c), c), s: cap(v.s, 86_400_000), version: 1 });
      }
    } else {
      const c = cap(rec.c, 10_000_000);
      // Days recorded before names were tracked: one lump, under a reserved id.
      if (c > 0) out.push({ day, naamId: "_day", c, r: Math.min(cap(rec.r, c), c), s: cap(rec.s, 86_400_000), version: 1 });
    }
  }
  return out;
}

type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean }>;

/** Every day of a practice, by name — lumps under the reserved `_day` id. */
function allEntries(hist: Record<string, DayRec> | undefined): Entry[] {
  return historyEntries(hist, "9999-12-31");
}

/**
 * "Add it to my account": the set-aside practice goes up as the installation it
 * was — under its own id, as one more device. The server ADDS devices, so it is
 * summed with the account instead of compared, which is the truth: these are
 * chants nobody counted anywhere else. Nothing is merged into this device's own
 * record, so nothing can go up twice. True once every batch was accepted.
 */
export async function uploadStash(storage: Storage, token: string | null, fetchFn: Fetch): Promise<boolean> {
  const stash = readStash(storage);
  if (!stash) return true;
  if (!token) return false;
  const hot = parse<HotBlob>(stash.hot);
  const state = join(hot, parse<ColdBlob>(stash.cold)).state;
  const sourceId = hot?.sourceId || newSourceId();
  const entries = allEntries(state.hist);
  for (let i = 0; i < entries.length; i += 200) {
    try {
      const res = await fetchFn("/api/sync/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sourceId,
          entries: entries.slice(i, i + 200).map((e) => ({ day: e.day, naamId: e.naamId, c: e.c, r: e.r, s: e.s, version: 1 })),
        }),
      });
      if (!res.ok) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Custom names and favourites from the set-aside practice, added to the current ones. */
export function namesFromStash(current: State, stashed: State): { custom: unknown[]; favs: unknown[] } {
  const custom = Array.isArray(current.custom) ? [...(current.custom as { id?: string }[])] : [];
  const ids = new Set(custom.map((c) => c?.id));
  for (const c of Array.isArray(stashed.custom) ? (stashed.custom as { id?: string }[]) : []) {
    if (c && typeof c.id === "string" && !ids.has(c.id)) {
      custom.push(c);
      ids.add(c.id);
    }
  }
  const favs = Array.isArray(current.favs) ? [...(current.favs as unknown[])] : [];
  for (const f of Array.isArray(stashed.favs) ? (stashed.favs as unknown[]) : []) if (!favs.includes(f)) favs.push(f);
  return { custom, favs };
}

/**
 * Before signing out: send what this device still owes the account. True when
 * nothing is left unsent — or the device never held the account's practice.
 * False means signing out now would lose chants, and the user should be told.
 */
export async function flushForSignOut(storage: Storage, token: string | null, fetchFn: Fetch): Promise<boolean> {
  const r = load(storage);
  const st = r.state;
  const linked = typeof st.owner === "string" || typeof st.syncFrom === "string";
  if (!linked) return true;
  if (typeof st.syncFrom !== "string") return !hasPractice(st); // never reached the server yet
  if (!token) return false;

  const post = async (body: unknown) => {
    try {
      const res = await fetchFn("/api/sync/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  const strip = (e: Entry) => ({ day: e.day, naamId: e.naamId, c: e.c, r: e.r, s: e.s, version: e.version });

  const owed = pending(readOutbox(r.outbox)).filter((e) => e.day >= (st.syncFrom as string));
  for (let i = 0; i < owed.length; i += 200) {
    if (!(await post({ sourceId: r.sourceId, entries: owed.slice(i, i + 200).map(strip) }))) return false;
  }
  if (st.historyUploaded !== true) {
    const old = historyEntries(st.hist, st.syncFrom);
    for (let i = 0; i < old.length; i += 200) {
      if (!(await post({ sourceId: r.sourceId, kind: "history", entries: old.slice(i, i + 200).map(strip) }))) return false;
    }
  }
  return true;
}
