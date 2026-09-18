import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  COLD_KEY,
  HOT_KEY,
  LEGACY_BACKUP_KEY,
  LEGACY_KEY,
  join,
  load,
  localStore,
  newSourceId,
  safeStorage,
  saveCold,
  saveHot,
  split,
  type State,
  type Storage,
} from "../../src/lib/counter/storage";

/** A localStorage stand-in that can be told to misbehave. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  let throwOn: "none" | "read" | "write" | "all" = "none";
  const api: Storage & {
    map: Map<string, string>;
    fail(mode: typeof throwOn): void;
  } = {
    map,
    fail(mode) {
      throwOn = mode;
    },
    getItem(k) {
      if (throwOn === "read" || throwOn === "all") throw new Error("blocked");
      return map.get(k) ?? null;
    },
    setItem(k, v) {
      if (throwOn === "write" || throwOn === "all") throw new Error("quota");
      map.set(k, v);
    },
    removeItem(k) {
      map.delete(k);
    },
  };
  return api;
}

const sourceId = "src-1";

function stateWith(overrides: Partial<State> = {}): State {
  return {
    count: 12,
    lifetime: 400,
    malaDone: 3,
    lastDay: "2026-09-09",
    nameId: "ram",
    target: 108,
    theme: "prabhat",
    hist: {
      "2026-09-08": { c: 108, r: 1, s: 300 },
      "2026-09-09": { c: 12, r: 0, s: 40 },
    },
    custom: [],
    favs: [],
    ...overrides,
  };
}

describe("split", () => {
  it("puts only what a tap changes in the hot blob", () => {
    const { hot } = split(stateWith(), { sourceId });
    expect(Object.keys(hot.fields).sort()).toEqual([
      "count",
      "lastDay",
      "lifetime",
      "malaDone",
      "nameId",
    ]);
    expect(hot.fields).not.toHaveProperty("hist");
    expect(hot.fields).not.toHaveProperty("theme");
  });

  it("carries today's history entry, and only today's", () => {
    const { hot } = split(stateWith(), { sourceId });
    expect(hot.day).toBe("2026-09-09");
    expect(hot.rec).toEqual({ c: 12, r: 0, s: 40 });
  });

  it("keeps the hot blob small even with a decade of history", () => {
    const hist: Record<string, { c: number; r: number; s: number }> = {};
    for (let i = 0; i < 3650; i++) {
      hist[`2016-01-${String((i % 28) + 1).padStart(2, "0")}-${i}`] = {
        c: 108,
        r: 1,
        s: 600,
      };
    }
    const { hot, cold } = split(stateWith({ hist }), { sourceId });
    const hotBytes = JSON.stringify(hot).length;
    const coldBytes = JSON.stringify(cold).length;
    // The point of the whole split: the per-tap write must not grow with the
    // user's history.
    expect(hotBytes).toBeLessThan(400);
    expect(coldBytes).toBeGreaterThan(100_000);
  });

  it("copes with a state that has no history and no day yet", () => {
    const { hot } = split({}, { sourceId });
    expect(hot.day).toBeNull();
    expect(hot.rec).toBeNull();
  });
});

describe("join", () => {
  it("rebuilds the state the split came from", () => {
    const before = stateWith();
    const { hot, cold } = split(before, { sourceId });
    expect(join(hot, cold).state).toEqual(before);
  });

  it("lets hot win, because cold can be a flush behind", () => {
    const { cold } = split(stateWith(), { sourceId });
    const { hot } = split(stateWith({ count: 99, lifetime: 487 }), { sourceId });
    const { state } = join(hot, cold);
    expect(state.count).toBe(99);
    expect(state.lifetime).toBe(487);
  });

  it("takes the larger of the two day records, never the newer", () => {
    const { cold } = split(stateWith(), { sourceId });
    // A stale hot blob must not be able to lower today's count.
    const { hot } = split(
      stateWith({ hist: { "2026-09-09": { c: 5, r: 0, s: 10 } } }),
      { sourceId },
    );
    const { state } = join(hot, cold);
    expect(state.hist?.["2026-09-09"]).toEqual({ c: 12, r: 0, s: 40 });
  });

  it("keeps the days only cold knows about", () => {
    const { hot, cold } = split(stateWith(), { sourceId });
    expect(join(hot, cold).state.hist?.["2026-09-08"]).toEqual({
      c: 108,
      r: 1,
      s: 300,
    });
  });

  it("survives either half being missing", () => {
    const { hot, cold } = split(stateWith(), { sourceId });
    expect(join(hot, null).state.count).toBe(12);
    expect(join(null, cold).state.count).toBe(12);
    expect(join(null, null).state).toEqual({});
  });
});

describe("load", () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
  });

  it("reports a genuinely new visitor as fresh, with an id", () => {
    const r = load(store);
    expect(r.fresh).toBe(true);
    expect(r.migrated).toBe(false);
    expect(r.sourceId).toBeTruthy();
  });

  it("migrates the old single-key format", () => {
    const legacy = stateWith();
    store.map.set(LEGACY_KEY, JSON.stringify(legacy));

    const r = load(store);
    expect(r.migrated).toBe(true);
    expect(r.state).toEqual(legacy);
  });

  it("keeps the pre-split bytes verbatim, and never deletes them", () => {
    const raw = JSON.stringify(stateWith());
    store.map.set(LEGACY_KEY, raw);

    load(store);
    expect(store.map.get(LEGACY_BACKUP_KEY)).toBe(raw);
    expect(store.map.get(LEGACY_KEY)).toBe(raw);
  });

  it("does not overwrite an existing backup on a later run", () => {
    store.map.set(LEGACY_BACKUP_KEY, '{"the":"original"}');
    store.map.set(LEGACY_KEY, JSON.stringify(stateWith()));

    load(store);
    expect(store.map.get(LEGACY_BACKUP_KEY)).toBe('{"the":"original"}');
  });

  it("prefers the split format once it exists, ignoring the legacy key", () => {
    saveHot(store, stateWith({ count: 77 }), { sourceId });
    saveCold(store, stateWith({ count: 77 }), { sourceId });
    store.map.set(LEGACY_KEY, JSON.stringify(stateWith({ count: 1 })));

    const r = load(store);
    expect(r.migrated).toBe(false);
    expect(r.state.count).toBe(77);
  });

  it("keeps the source id across a save and reload", () => {
    saveHot(store, stateWith(), { sourceId });
    expect(load(store).sourceId).toBe(sourceId);
  });

  it("treats corrupt JSON as absent rather than throwing", () => {
    store.map.set(HOT_KEY, "{not json");
    store.map.set(COLD_KEY, "also not json");
    expect(() => load(store)).not.toThrow();
    expect(load(store).fresh).toBe(true);
  });

  it("treats a JSON array or string as absent", () => {
    store.map.set(HOT_KEY, "[1,2,3]");
    store.map.set(COLD_KEY, '"hello"');
    expect(load(store).fresh).toBe(true);
  });
});

describe("safeStorage", () => {
  it("returns null instead of throwing when reads are refused", () => {
    const s = safeStorage(fakeStorage());
    const inner = fakeStorage();
    inner.fail("all");
    const guarded = safeStorage(inner);
    expect(() => guarded.getItem("x")).not.toThrow();
    expect(guarded.getItem("x")).toBeNull();
    expect(s.getItem("x")).toBeNull();
  });

  it("swallows a failed write, because the counter must keep counting", () => {
    const inner = fakeStorage();
    inner.fail("write");
    const guarded = safeStorage(inner);
    expect(() => guarded.setItem("x", "1")).not.toThrow();
  });

  it("works with no storage object at all", () => {
    const s = safeStorage(null);
    expect(s.getItem("x")).toBeNull();
    expect(() => s.setItem("x", "1")).not.toThrow();
  });

  it("lets load report a fresh start when storage is unreadable", () => {
    const inner = fakeStorage();
    inner.fail("all");
    expect(load(safeStorage(inner)).fresh).toBe(true);
  });
});

describe("newSourceId", () => {
  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, newSourceId));
    expect(seen.size).toBe(200);
  });
});

/*
 * The property access itself, not the methods.
 *
 * `safeStorage` has always guarded getItem/setItem/removeItem, but both callers
 * read `window.localStorage` to hand it over, and in a context that refuses at
 * the property that read threw before any guard existed — straight past React,
 * out to the Next.js error screen, whole page gone. This is that read.
 */
describe("localStore", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");

  function setWindow(value: PropertyDescriptor | null) {
    if (value) Object.defineProperty(globalThis, "window", value);
    else Reflect.deleteProperty(globalThis, "window");
  }

  afterEach(() => {
    setWindow(original ?? null);
  });

  it("survives a localStorage getter that throws", () => {
    setWindow({
      configurable: true,
      value: {
        get localStorage(): Storage {
          throw new Error("Access denied to localStorage");
        },
      },
    });

    let s!: Storage;
    expect(() => {
      s = localStore();
    }).not.toThrow();
    expect(s.getItem(HOT_KEY)).toBeNull();
    expect(() => s.setItem(HOT_KEY, "1")).not.toThrow();
  });

  it("returns null on the server, where there is no window", () => {
    setWindow(null);
    expect(localStore().getItem(HOT_KEY)).toBeNull();
  });

  it("reads and writes through when storage is available", () => {
    const inner = fakeStorage();
    setWindow({ configurable: true, value: { localStorage: inner } });

    const s = localStore();
    s.setItem(HOT_KEY, "kept");
    expect(s.getItem(HOT_KEY)).toBe("kept");
    expect(inner.map.get(HOT_KEY)).toBe("kept");
  });
});
