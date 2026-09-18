/**
 * Local persistence.
 * Specification sections 10, 90, 92.
 *
 * Split by rule:
 *   localStorage  small settings only
 *   IndexedDB     sessions, snapshots, custom dhikr, daily totals, sync queue
 *
 * Section 90: never write on every tap. Count in memory, persist on a throttle,
 * and always flush on visibilitychange and pagehide.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  CounterState,
  DailyTotal,
  Dhikr,
  Session,
  Settings,
} from "@/core/types";
import type { Sequence } from "@/core/sequences";

const DB_NAME = "tasbihcounts";
// Version 2 adds the sequences store (section 4, premium feature 2).
const DB_VERSION = 2;

interface TCSchema extends DBSchema {
  sessions: {
    key: string;
    value: Session;
    indexes: { byLocalDate: string; byStatus: string };
  };
  snapshots: {
    /** Per user per dhikr, not per device (section 83). Guest uses "local". */
    key: string;
    value: CounterState & { updatedAt: number };
  };
  customDhikr: { key: string; value: Dhikr };
  sequences: { key: string; value: Sequence };
  dailyTotals: { key: string; value: DailyTotal };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<TCSchema>> | null = null;

/* ------------------------------------------------ durable storage --------- */

/**
 * THE MOST IMPORTANT FUNCTION IN THIS FILE.
 *
 * IndexedDB is "best effort" by default. A browser may evict it under storage
 * pressure at any moment and — far worse — Safari deletes all script-writable
 * storage after SEVEN DAYS of not visiting the site, for any site that has not
 * been added to the home screen. Chrome and Firefox evict under pressure.
 *
 * This product tells people they can count for years without an account. A
 * guest who took a week off would have returned to a lifetime total of zero, an
 * empty streak and no custom dhikr — with nothing anywhere to restore from,
 * because as a guest we deliberately never had a copy.
 *
 * navigator.storage.persist() is the only defence. Once granted the browser
 * must not evict without an explicit user action. Chrome grants it silently
 * once the site looks engaged (installed, bookmarked, or high engagement),
 * Firefox prompts, and Safari grants it on "Add to Home Screen".
 *
 * Asked once per device, remembered, and never allowed to throw.
 */
export type PersistState = "persisted" | "denied" | "unsupported" | "unknown";

let persistState: PersistState = "unknown";

export function persistedStateSync(): PersistState {
  return persistState;
}

export async function requestPersistentStorage(): Promise<PersistState> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) {
      persistState = "unsupported";
      return persistState;
    }
    // Already granted on a previous visit: never ask twice.
    if (await navigator.storage.persisted()) {
      persistState = "persisted";
      writeLocal("storagePersisted", true);
      return persistState;
    }
    const granted = await navigator.storage.persist();
    persistState = granted ? "persisted" : "denied";
    writeLocal("storagePersisted", granted);
    return persistState;
  } catch {
    persistState = "unknown";
    return persistState;
  }
}

/** How much room is left, for the honest warning on the account screen. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/**
 * A database upgrade is stuck behind another tab, or this tab has been asked to
 * step aside. The UI subscribes so it can tell the reader to close the other
 * tab, rather than leaving them looking at a counter that will never save.
 */
type BlockedListener = () => void;
const blockedListeners = new Set<BlockedListener>();

export function onStorageBlocked(fn: BlockedListener): () => void {
  blockedListeners.add(fn);
  return () => blockedListeners.delete(fn);
}

function notifyBlocked(): void {
  for (const fn of blockedListeners) {
    try {
      fn();
    } catch {
      /* a listener must never break storage */
    }
  }
}

function db(): Promise<IDBPDatabase<TCSchema>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  dbPromise ??= openDB<TCSchema>(DB_NAME, DB_VERSION, {
    /**
     * Another tab holds the old version open, so this upgrade cannot run.
     * Without this handler the promise never settles and the counter hangs for
     * ever with no message. The service worker uses skipWaiting, so a new build
     * reaching one tab while another stays open is not a rare case — it is the
     * normal case.
     */
    blocked() {
      notifyBlocked();
    },

    /** This tab is the OLD one and a newer tab wants to upgrade. Step aside. */
    blocking(_currentVersion, _blockedVersion, event) {
      try {
        (event.target as IDBPDatabase<TCSchema> | null)?.close();
      } catch {
        /* closing is best effort */
      }
      dbPromise = null;
      notifyBlocked();
    },

    // Guarded per store, so upgrading an existing device adds only what is
    // missing and never drops what is already there.
    upgrade(database) {
      if (!database.objectStoreNames.contains("sessions")) {
        const sessions = database.createObjectStore("sessions", { keyPath: "id" });
        sessions.createIndex("byLocalDate", "localDate");
        sessions.createIndex("byStatus", "status");
      }
      if (!database.objectStoreNames.contains("snapshots")) {
        database.createObjectStore("snapshots");
      }
      if (!database.objectStoreNames.contains("customDhikr")) {
        database.createObjectStore("customDhikr", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("dailyTotals")) {
        database.createObjectStore("dailyTotals", { keyPath: "localDate" });
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta");
      }
      if (!database.objectStoreNames.contains("sequences")) {
        database.createObjectStore("sequences", { keyPath: "id" });
      }
    },
  });
  return dbPromise;
}

/** Every IndexedDB call is optional. Counting must never break (section 123). */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/* ---------- sessions ---------- */

export async function putSession(s: Session): Promise<void> {
  await safe(async () => {
    await (await db()).put("sessions", s);
  }, undefined);
}

export async function deleteSession(id: string): Promise<void> {
  await safe(async () => {
    await (await db()).delete("sessions", id);
  }, undefined);
}

export async function allSessions(): Promise<Session[]> {
  return safe(async () => (await db()).getAll("sessions"), []);
}

export async function sessionsForDate(localDate: string): Promise<Session[]> {
  return safe(
    async () => (await db()).getAllFromIndex("sessions", "byLocalDate", localDate),
    [],
  );
}

export async function openSessions(): Promise<Session[]> {
  return safe(
    async () => (await db()).getAllFromIndex("sessions", "byStatus", "open"),
    [],
  );
}

/* ---------- snapshots (section 133) ---------- */

export async function putSnapshot(state: CounterState): Promise<void> {
  await safe(async () => {
    await (await db()).put(
      "snapshots",
      { ...state, updatedAt: Date.now() },
      state.dhikrId,
    );
  }, undefined);
}

export async function getSnapshot(
  dhikrId: string,
): Promise<(CounterState & { updatedAt: number }) | undefined> {
  return safe(async () => (await db()).get("snapshots", dhikrId), undefined);
}

export async function allSnapshots(): Promise<
  (CounterState & { updatedAt: number })[]
> {
  return safe(async () => (await db()).getAll("snapshots"), []);
}

export async function clearSnapshot(dhikrId: string): Promise<void> {
  await safe(async () => {
    await (await db()).delete("snapshots", dhikrId);
  }, undefined);
}

/* ---------- custom dhikr (section 49) ---------- */

export async function putCustomDhikr(d: Dhikr): Promise<void> {
  await safe(async () => {
    await (await db()).put("customDhikr", d);
  }, undefined);
}

export async function allCustomDhikr(): Promise<Dhikr[]> {
  return safe(async () => (await db()).getAll("customDhikr"), []);
}

export async function deleteCustomDhikr(id: string): Promise<void> {
  await safe(async () => {
    await (await db()).delete("customDhikr", id);
  }, undefined);
}

/* ---------- custom sequences (section 4, premium feature 2) ---------- */

export async function putSequence(s: Sequence): Promise<void> {
  await safe(async () => {
    await (await db()).put("sequences", s);
  }, undefined);
}

export async function allSequences(): Promise<Sequence[]> {
  return safe(async () => (await db()).getAll("sequences"), []);
}

export async function deleteSequence(id: string): Promise<void> {
  await safe(async () => {
    await (await db()).delete("sequences", id);
  }, undefined);
}

/* ---------- daily totals rollup (section 83) ---------- */

export async function putDailyTotal(d: DailyTotal): Promise<void> {
  await safe(async () => {
    await (await db()).put("dailyTotals", d);
  }, undefined);
}

export async function allDailyTotals(): Promise<DailyTotal[]> {
  return safe(async () => (await db()).getAll("dailyTotals"), []);
}

/* ---------- destructive, user initiated only (section 9) ---------- */

export async function clearDeviceData(): Promise<void> {
  await safe(async () => {
    const d = await db();
    await Promise.all([
      d.clear("sessions"),
      d.clear("snapshots"),
      d.clear("customDhikr"),
      d.clear("sequences"),
      d.clear("dailyTotals"),
      d.clear("meta"),
    ]);
  }, undefined);
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("tc.")) localStorage.removeItem(k);
    }
  } catch {
    /* private mode */
  }
}

/*
 * exportAll() was removed on 2026-09-06 at the owner's instruction (gap 10).
 *
 * It is recorded here rather than silently deleted, because the privacy page
 * still promises that a person can take their data with them. That promise is
 * now kept by cloud sync for anyone signed in, and the privacy page says
 * plainly that a guest who clears their browser has no backup because we never
 * had a copy. If the promise is ever restored, restore it here: the four
 * all*() readers above are all it needed.
 */

/* ---------- settings, localStorage only (section 10) ---------- */

const SETTINGS_KEY = "tc.settings";

export const DEFAULT_SETTINGS: Settings = {
  skin: "ring",
  tickSound: "tick",
  volume: 0.7,
  theme: "system",
  // Section 26: sound is off by default.
  sound: false,
  // Section 27, revised by research: on for touch, off for pointer devices.
  // The value here is the pointer default; the store raises it on touch.
  vibration: false,
  wakeLock: false,
  countdown: false,
  numerals: "latin",
  defaultTarget: null,
  locale: "en",
  // Follow the device by default (section 107: detect, never force-redirect).
  localeAuto: true,
  installPromptSeen: false,
  reducedGlow: false,
};

export function loadSettings(): Settings {
  // Inside the try: some locked-down contexts throw on the property itself,
  // and typeof does not guard against a getter that throws.
  try {
    if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode, ignore */
  }
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`tc.${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(`tc.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/* ---------- throttled writer (section 90) ---------- */

export function createFlusher(intervalMs = 1200) {
  let pending: (() => Promise<void>) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = async () => {
    timer = null;
    const job = pending;
    pending = null;
    if (job) await job();
  };

  return {
    schedule(job: () => Promise<void>) {
      pending = job;
      timer ??= setTimeout(run, intervalMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await run();
    },
  };
}
