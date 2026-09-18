/**
 * Where the counter's state lives on disk, and how it gets there.
 *
 * The engine keeps one object, `S`, and used to write all of it to a single
 * localStorage key on every tap. That is the hottest operation in the app and it
 * got slower every day a user practised, because `S.hist` grows by one entry per
 * day forever. Ten years of history is around 165 KB to serialise, on the main
 * thread, between the tap and the paint.
 *
 * So the same object is now written to two keys:
 *
 *   njc.hot   what a tap changes — a fraction of a kilobyte, written every tap
 *   njc.cold  history, settings, custom names — written when it actually changes
 *
 * The in-memory shape does not change at all. The engine still reads `S.hist`,
 * `S.count` and the rest exactly as before; only persistence is split. That
 * matters because the engine is a thousand lines of working code and this phase
 * is not the place to restructure it.
 *
 * Nothing here touches the network. See docs/SPEC.md §8.
 */

/** Counts, rounds and milliseconds on the mala. */
export type NameRec = { c: number; r: number; s: number };

/**
 * One day.
 *
 * `n` splits the same three numbers by the name being chanted. It is optional
 * because days recorded before the breakdown existed do not have one, and stats
 * says so rather than inventing an attribution. Where it is present the parts
 * add up to the whole.
 */
export type DayRec = NameRec & { n?: Record<string, NameRec> };

/** The engine's state object, from this module's point of view. */
export type State = Record<string, unknown> & {
  hist?: Record<string, DayRec>;
  lastDay?: string;
};

export const LEGACY_KEY = "njc.v1";
/** When this device last reached the account; written by the engine, read on the account page. */
export const SYNCED_KEY = "njc.synced";
export const HOT_KEY = "njc.hot";
export const COLD_KEY = "njc.cold";
/** The pre-split state, kept forever rather than deleted. See `migrate`. */
export const LEGACY_BACKUP_KEY = "njc.legacy_v1";

export const SCHEMA_VERSION = 2;

/**
 * Fields a single tap can change. Everything else in `S` is cold.
 *
 * `lastDay` is here because a tap after midnight rewrites it, and `nameId`
 * because switching names mid-session must survive a crash — both are two bytes
 * and neither is worth a cold write.
 */
export const HOT_FIELDS = [
  "count",
  "lifetime",
  "malaDone",
  "lastDay",
  "nameId",
] as const;

export type HotBlob = {
  v: number;
  sourceId: string;
  fields: Record<string, unknown>;
  /** Today's history entry, the only one a tap can touch. */
  day: string | null;
  rec: DayRec | null;
  /** Pending sync work and the last server-acknowledged values. */
  outbox: unknown;
  watermark: unknown;
};

export type ColdBlob = {
  v: number;
  state: Record<string, unknown>;
};

/** A storage that may throw on every access — see `safeStorage`. */
export type Storage = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  /** True once a write was refused or there is no storage at all (#45). */
  writeFailed?(): boolean;
};

/**
 * Private browsing, blocked site data, and a few embedded contexts make even
 * *reading* localStorage throw. A counter that cannot persist must still count —
 * but it must be able to say so, or a reload silently loses the practice (#45).
 */
export function safeStorage(raw?: Storage | null): Storage {
  const store = raw ?? null;
  let failed = false;
  return {
    writeFailed() {
      return failed || store === null;
    },
    getItem(k) {
      try {
        return store ? store.getItem(k) : null;
      } catch {
        return null;
      }
    },
    setItem(k, v) {
      try {
        store?.setItem(k, v);
      } catch {
        /* full, or refused; the in-memory state is still correct, but a reload
           would lose it — remembered so the counter can say so */
        failed = true;
      }
    },
    removeItem(k) {
      try {
        store?.removeItem(k);
      } catch {
        /* as above */
      }
    },
  };
}

/**
 * Reading the `localStorage` *property* can itself throw — some embedded and
 * locked-down contexts refuse at the property, not at `getItem`. That throw is
 * outside every try/catch the wrapper installs, so it escapes to React and
 * takes the whole page down with the error screen. Acquire the object here,
 * once, behind a guard: no storage simply means no persistence.
 */
export function localStore(): Storage {
  let raw: Storage | null = null;
  try {
    if (typeof window !== "undefined") raw = window.localStorage;
  } catch {
    /* denied; the counter still counts, it just cannot remember */
  }
  return safeStorage(raw);
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    // An array is `typeof "object"` too, and a stored `[1,2,3]` sailing through
    // as a blob would leave the engine reading fields off an array rather than
    // starting clean.
    return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

/**
 * A random id for this browser installation — not a user and not a device.
 *
 * It is the `source_id` of docs/SPEC.md §6: the key under which this
 * installation's own contribution is stored, so two devices add up instead of
 * overwriting each other. Clearing site data mints a new one, which is correct —
 * that installation genuinely restarts from zero and its earlier contribution is
 * already safe under the old id.
 */
export function newSourceId(): string {
  const g = globalThis.crypto;
  if (g && typeof g.randomUUID === "function") return g.randomUUID();
  if (g && typeof g.getRandomValues === "function") {
    const b = g.getRandomValues(new Uint8Array(16));
    return Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  }
  // Only reachable on a browser with no Web Crypto at all. Uniqueness here is
  // about not colliding with the user's own other installations, not secrecy.
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A stamp every save rewrites, so a tab can tell cheaply whether another tab has
 * saved since it last looked. Every open tab counts; before changing anything a
 * tab compares this one short key, and takes in the other tab's state if it moved.
 */
export const REV_KEY = "njc.rev";

export function touchRev(storage: Storage): string {
  const rev = newSourceId();
  storage.setItem(REV_KEY, rev);
  return rev;
}

export function readRev(storage: Storage): string | null {
  return storage.getItem(REV_KEY);
}

/**
 * Most browsers give a site about 5 MB of localStorage, counted in UTF-16 code
 * units. A merge that would not fit is refused before it replaces anything,
 * rather than failing half-written.
 */
export const MAX_STORED_CHARS = 2_400_000;

export function tooLarge(state: State): boolean {
  try {
    return JSON.stringify(state).length > MAX_STORED_CHARS;
  } catch {
    return true;
  }
}

/** Split `S` into the part a tap rewrites and the part it does not. */
export function split(
  state: State,
  meta: { sourceId: string; outbox?: unknown; watermark?: unknown },
): { hot: HotBlob; cold: ColdBlob } {
  const fields: Record<string, unknown> = {};
  for (const k of HOT_FIELDS) {
    if (state[k] !== undefined) fields[k] = state[k];
  }

  const day = typeof state.lastDay === "string" ? state.lastDay : null;
  const hist = state.hist ?? {};
  const rec = day && hist[day] ? { ...hist[day] } : null;

  // Cold carries the whole state including history. Today's entry is in both,
  // and hot wins on read — one duplicated 30-byte record is cheaper than
  // teaching every reader that history has a hole in it.
  const cold: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) cold[k] = v;

  return {
    hot: {
      v: SCHEMA_VERSION,
      sourceId: meta.sourceId,
      fields,
      day,
      rec,
      outbox: meta.outbox ?? {},
      watermark: meta.watermark ?? {},
    },
    cold: { v: SCHEMA_VERSION, state: cold },
  };
}

/**
 * Rebuild `S` from the two blobs. Hot wins wherever both have an opinion,
 * because cold may be up to one flush interval behind.
 */
export function join(
  hot: HotBlob | null,
  cold: ColdBlob | null,
): { state: State; sourceId: string | null; outbox: unknown; watermark: unknown } {
  const state: State = cold?.state ? { ...cold.state } : {};

  if (hot) {
    for (const [k, v] of Object.entries(hot.fields ?? {})) state[k] = v;
    if (hot.day && hot.rec) {
      const hist = { ...(state.hist ?? {}) };
      const cold_ = hist[hot.day];
      // Counts only ever rise (docs/SPEC.md §2), so where the two disagree the
      // larger is the true one. This is the same rule the server merge uses,
      // applied to the gap between a hot write and a cold flush.
      hist[hot.day] = cold_ ? mergeDay(cold_, hot.rec) : { ...hot.rec };
      state.hist = hist;
    }
  }

  return {
    state,
    sourceId: hot?.sourceId ?? null,
    outbox: hot?.outbox ?? {},
    watermark: hot?.watermark ?? {},
  };
}

/**
 * Two views of one day, reconciled. Counts only ever rise (docs/SPEC.md §2), so
 * where the halves disagree the larger is the true one — the same rule the
 * server merge uses, applied to the gap between a hot write and a cold flush.
 */
function mergeDay(a: DayRec, b: DayRec): DayRec {
  const out: DayRec = {
    c: Math.max(a.c | 0, b.c | 0),
    r: Math.max(a.r | 0, b.r | 0),
    s: Math.max(a.s | 0, b.s | 0),
  };
  if (a.n || b.n) {
    const n: Record<string, NameRec> = {};
    for (const id of new Set([...Object.keys(a.n ?? {}), ...Object.keys(b.n ?? {})])) {
      const x = a.n?.[id];
      const y = b.n?.[id];
      n[id] = {
        c: Math.max(x?.c ?? 0, y?.c ?? 0),
        r: Math.max(x?.r ?? 0, y?.r ?? 0),
        s: Math.max(x?.s ?? 0, y?.s ?? 0),
      };
    }
    out.n = n;
  }
  return out;
}

export type LoadResult = {
  state: State;
  sourceId: string;
  outbox: unknown;
  watermark: unknown;
  /** True on the first run after the single-key format was left behind. */
  migrated: boolean;
  /** True when there was nothing stored at all — a genuinely new visitor. */
  fresh: boolean;
};

/**
 * Read the counter's state, migrating the old single-key format if that is what
 * is there.
 *
 * The pre-split blob is copied to `njc.legacy_v1` and **never deleted**. It is a
 * few hundred kilobytes at worst, and it is the only copy of a practice someone
 * may have kept for years — if this migration turns out to have a bug, that key
 * is the difference between a fix and an apology.
 */
export function load(storage: Storage): LoadResult {
  const hot = parse<HotBlob>(storage.getItem(HOT_KEY));
  const cold = parse<ColdBlob>(storage.getItem(COLD_KEY));

  if (hot || cold) {
    const joined = join(hot, cold);
    return {
      ...joined,
      sourceId: joined.sourceId ?? newSourceId(),
      migrated: false,
      fresh: false,
    };
  }

  const legacy = parse<State>(storage.getItem(LEGACY_KEY));
  if (legacy) {
    // Keep the original bytes, not a re-serialised copy: if the migration is
    // wrong, the thing worth having is exactly what was there.
    const raw = storage.getItem(LEGACY_KEY);
    if (raw && !storage.getItem(LEGACY_BACKUP_KEY)) {
      storage.setItem(LEGACY_BACKUP_KEY, raw);
    }
    return {
      state: legacy,
      sourceId: newSourceId(),
      outbox: {},
      watermark: {},
      migrated: true,
      fresh: false,
    };
  }

  return {
    state: {},
    sourceId: newSourceId(),
    outbox: {},
    watermark: {},
    migrated: false,
    fresh: true,
  };
}

/** Write the hot blob. Called on every tap, so it does exactly this much. */
export function saveHot(
  storage: Storage,
  state: State,
  meta: { sourceId: string; outbox?: unknown; watermark?: unknown },
): void {
  storage.setItem(HOT_KEY, JSON.stringify(split(state, meta).hot));
}

/** Write the cold blob. Called when history or settings actually change. */
export function saveCold(
  storage: Storage,
  state: State,
  meta: { sourceId: string },
): void {
  storage.setItem(COLD_KEY, JSON.stringify(split(state, meta).cold));
}

/**
 * Ask the browser not to evict this origin's storage.
 *
 * iOS Safari clears site data for origins the user has not visited in a while,
 * which for this app means deleting someone's practice. The request is often
 * granted outright once a site has been used repeatedly or installed to the home
 * screen, and the browser may simply say no — so the answer is worth knowing but
 * never worth blocking on.
 */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    const s = navigator?.storage;
    if (!s || typeof s.persist !== "function") return null;
    if (typeof s.persisted === "function" && (await s.persisted())) return true;
    return await s.persist();
  } catch {
    return null;
  }
}
