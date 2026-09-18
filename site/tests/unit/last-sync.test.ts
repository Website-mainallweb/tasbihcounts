import { describe, expect, it } from "vitest";

import { SYNCED_KEY, agoLabel, clearSynced, markSynced, readSynced } from "../../src/lib/counter/last-sync";
import type { Storage } from "../../src/lib/counter/storage";

/** "Last synced" on the account page (UX walkthrough #21). */

function memoryStore(seed: Record<string, string> = {}): Storage & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  } as Storage & { map: Map<string, string> };
}

describe("the stamp", () => {
  it("is nothing until a sync has happened", () => {
    expect(readSynced(memoryStore())).toBeNull();
  });

  it("comes back as it was written", () => {
    const store = memoryStore();
    markSynced(store, 1_700_000_000_000);
    expect(store.map.get(SYNCED_KEY)).toBe("1700000000000");
    expect(readSynced(store, 1_700_000_060_000)).toBe(1_700_000_000_000);
  });

  it("ignores nonsense rather than showing it", () => {
    expect(readSynced(memoryStore({ [SYNCED_KEY]: "soon" }))).toBeNull();
    expect(readSynced(memoryStore({ [SYNCED_KEY]: "0" }))).toBeNull();
  });

  it("never reads as the future, however wrong the clock was", () => {
    const store = memoryStore();
    markSynced(store, 2_000_000_000_000);
    expect(readSynced(store, 1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("is dropped when the device leaves the account", () => {
    const store = memoryStore();
    markSynced(store);
    clearSynced(store);
    expect(readSynced(store)).toBeNull();
  });
});

describe("how long ago, in words", () => {
  const now = 1_700_000_000_000;
  const ago = (ms: number) => agoLabel(now - ms, now);

  it("is coarse on purpose", () => {
    expect(ago(5_000)).toBe("just now");
    expect(ago(60_000)).toBe("a minute ago");
    expect(ago(10 * 60_000)).toBe("10 minutes ago");
    expect(ago(60 * 60_000)).toBe("an hour ago");
    expect(ago(5 * 60 * 60_000)).toBe("5 hours ago");
    expect(ago(24 * 60 * 60_000)).toBe("yesterday");
    expect(ago(4 * 24 * 60 * 60_000)).toBe("4 days ago");
  });

  it("gives a date once counting days stops meaning anything", () => {
    expect(ago(200 * 24 * 60 * 60_000)).toMatch(/\d{4}/);
  });
});
