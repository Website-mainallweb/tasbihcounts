import { describe, expect, it, vi } from "vitest";

import {
  STASH_KEY,
  chantsIn,
  decide,
  flushForSignOut,
  historyEntries,
  leaveDevice,
  namesFromStash,
  readStash,
  setAside,
  startEmptyFor,
  stashedState,
  uploadStash,
} from "../../src/lib/counter/account-link";
import { localOnly } from "../../src/lib/counter/backup";
import { load, saveCold, saveHot, type State, type Storage } from "../../src/lib/counter/storage";

const TODAY = "2026-09-11";

function memory(opts: { refuse?: string } = {}) {
  const map = new Map<string, string>();
  const api: Storage & { map: Map<string, string> } = {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (k === opts.refuse) return; // a full or refusing store: the write is lost
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
  };
  return api;
}

function seed(store: Storage, state: State, meta: { sourceId?: string; outbox?: unknown } = {}) {
  const sourceId = meta.sourceId ?? "device-1";
  saveCold(store, state, { sourceId });
  saveHot(store, { ...state, lastDay: state.lastDay ?? TODAY }, { sourceId, outbox: meta.outbox ?? {}, watermark: {} });
}

const practice = (): State => ({
  theme: "ratri",
  lang: "hi",
  target: 27,
  count: 12,
  lifetime: 300,
  malaDone: 2,
  nameId: "ram",
  custom: [{ id: "c1", n: "ॐ", t: "Om", m: "" }],
  hist: {
    "2026-09-10": { c: 200, r: 1, s: 1000, n: { ram: { c: 200, r: 1, s: 1000 } } },
    [TODAY]: { c: 100, r: 0, s: 500, n: { ram: { c: 100, r: 0, s: 500 } } },
  },
  lastDay: TODAY,
});

describe("decide: whose practice this device holds", () => {
  it("knows its own account", () => {
    expect(decide({ owner: "u1", lifetime: 5 }, "u1")).toBe("linked");
  });
  it("sees another account's practice", () => {
    expect(decide({ owner: "u2", lifetime: 5 }, "u1")).toBe("switch");
  });
  it("adopts a device that synced before owners were recorded", () => {
    expect(decide({ syncFrom: "2026-09-01", lifetime: 5 }, "u1")).toBe("adopt");
  });
  it("simply claims an empty device", () => {
    expect(decide({ lifetime: 0, hist: {} }, "u1")).toBe("claim");
  });
  it("asks the cloud when a free practice is here", () => {
    expect(decide(practice(), "u1")).toBe("ask-cloud");
  });
});

describe("an old account signs in on a device with its own practice", () => {
  it("sets the practice aside untouched and starts empty, keeping settings", () => {
    const store = memory();
    seed(store, practice(), { sourceId: "free-device" });
    const before = { hot: store.getItem("njc.hot"), cold: store.getItem("njc.cold") };

    expect(setAside(store, "u1", TODAY)).toBe(true);

    const stash = readStash(store);
    expect(stash?.hot).toBe(before.hot);
    expect(stash?.cold).toBe(before.cold);

    const now = load(store);
    expect(now.state.lifetime).toBe(0);
    expect(now.state.hist).toEqual({});
    expect(now.state.custom).toEqual([]);
    expect(now.state.owner).toBe("u1");
    expect(now.state.theme).toBe("ratri");
    expect(now.state.lang).toBe("hi");
    expect(now.state.target).toBe(27);
    expect(now.sourceId).not.toBe("free-device");
  });

  it("changes nothing when the copy cannot be written", () => {
    const store = memory({ refuse: STASH_KEY });
    seed(store, practice());
    expect(setAside(store, "u1", TODAY)).toBe(false);
    expect(load(store).state.lifetime).toBe(300);
    expect(load(store).state.owner).toBeUndefined();
  });

  it("keeps the first copy if it is asked twice", () => {
    const store = memory();
    seed(store, practice());
    setAside(store, "u1", TODAY);
    setAside(store, "u1", TODAY);
    expect(chantsIn(stashedState(store) ?? {})).toBe(300);
  });
});

describe("signing out", () => {
  it("gives the device back its own practice, with the settings it has now", () => {
    const store = memory();
    seed(store, practice(), { sourceId: "free-device" });
    setAside(store, "u1", TODAY);
    // Signed in, the user switched theme and the account counted here.
    const signedIn = load(store);
    seed(store, { ...signedIn.state, theme: "prabhat", lifetime: 50, hist: { [TODAY]: { c: 50, r: 0, s: 0 } } });

    leaveDevice(store, TODAY);

    const back = load(store);
    expect(back.state.lifetime).toBe(300);
    expect(chantsIn(back.state)).toBe(300);
    expect(back.state.theme).toBe("prabhat");
    expect(back.state.owner).toBeUndefined();
    expect(back.sourceId).toBe("free-device");
    expect(readStash(store)).toBeNull();
  });

  it("leaves an empty counter when nothing was set aside", () => {
    const store = memory();
    seed(store, { ...practice(), owner: "u1", syncFrom: "2026-09-01" });
    leaveDevice(store, TODAY);
    const after = load(store);
    expect(after.state.lifetime).toBe(0);
    expect(after.state.hist).toEqual({});
    expect(after.state.owner).toBeUndefined();
    expect(after.state.syncFrom).toBeUndefined();
    expect(after.state.theme).toBe("ratri");
  });
});

describe("a different account on this device", () => {
  it("starts empty for the new one", () => {
    const store = memory();
    seed(store, { ...practice(), owner: "u2", syncFrom: "2026-09-01" });
    startEmptyFor(store, "u1", TODAY);
    const after = load(store);
    expect(after.state.owner).toBe("u1");
    expect(after.state.lifetime).toBe(0);
    expect(after.state.syncFrom).toBeUndefined();
  });
});

describe("historyEntries", () => {
  it("covers only days before the first sync, lumps included", () => {
    const out = historyEntries(
      {
        "2026-09-01": { c: 10, r: 0, s: 0 },
        "2026-09-10": { c: 5, r: 9, s: 99, n: { ram: { c: 5, r: 9, s: 99 } } },
        [TODAY]: { c: 7, r: 0, s: 0, n: { ram: { c: 7, r: 0, s: 0 } } },
      },
      TODAY,
    );
    expect(out).toEqual([
      { day: "2026-09-01", naamId: "_day", c: 10, r: 0, s: 0, version: 1 },
      { day: "2026-09-10", naamId: "ram", c: 5, r: 5, s: 99, version: 1 },
    ]);
  });
});

describe("flushForSignOut", () => {
  const ok = () => vi.fn(async () => ({ ok: true }));

  it("has nothing to send for a device that never held the account's practice", async () => {
    const store = memory();
    seed(store, practice());
    const f = ok();
    await expect(flushForSignOut(store, "t", f)).resolves.toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("sends what is owed, then the unsent history, and reports success", async () => {
    const store = memory();
    const entry = { day: TODAY, naamId: "ram", c: 100, r: 0, s: 500, version: 3 };
    seed(store, { ...practice(), owner: "u1", syncFrom: TODAY }, { outbox: { [`${TODAY}|ram`]: entry } });
    const f = ok();
    await expect(flushForSignOut(store, "tok", f)).resolves.toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String((f.mock.calls[0] as unknown[])[1] && ((f.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(first.entries).toEqual([entry]);
    const second = JSON.parse(String(((f.mock.calls[1] as unknown[])[1] as RequestInit).body));
    expect(second.kind).toBe("history");
  });

  it("says so when the network fails", async () => {
    const store = memory();
    const entry = { day: TODAY, naamId: "ram", c: 1, r: 0, s: 0, version: 1 };
    seed(store, { ...practice(), owner: "u1", syncFrom: TODAY, historyUploaded: true }, { outbox: { k: entry } });
    await expect(flushForSignOut(store, "tok", async () => ({ ok: false }))).resolves.toBe(false);
    await expect(flushForSignOut(store, "tok", async () => Promise.reject(new Error("offline")))).resolves.toBe(false);
  });

  it("refuses when the account's practice never reached the server", async () => {
    const store = memory();
    seed(store, { ...practice(), owner: "u1" });
    await expect(flushForSignOut(store, "tok", ok())).resolves.toBe(false);
  });

  it("refuses without a session to send with", async () => {
    const store = memory();
    const entry = { day: TODAY, naamId: "ram", c: 1, r: 0, s: 0, version: 1 };
    seed(store, { ...practice(), owner: "u1", syncFrom: TODAY }, { outbox: { k: entry } });
    await expect(flushForSignOut(store, null, ok())).resolves.toBe(false);
  });
});

describe("adding a set-aside practice to the account", () => {
  it("sends every day under the old installation's own id, so the server adds it", async () => {
    const store = memory();
    seed(store, practice(), { sourceId: "free-device" });
    setAside(store, "u1", TODAY);
    const f = vi.fn(async () => ({ ok: true }));
    await expect(uploadStash(store, "tok", f)).resolves.toBe(true);
    const body = JSON.parse(String(((f.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body.sourceId).toBe("free-device");
    expect(body.kind).toBeUndefined();
    expect(body.entries.map((e: { day: string }) => e.day).sort()).toEqual(["2026-09-10", TODAY]);
  });

  it("reports failure without a session or when the server refuses", async () => {
    const store = memory();
    seed(store, practice());
    setAside(store, "u1", TODAY);
    await expect(uploadStash(store, null, async () => ({ ok: true }))).resolves.toBe(false);
    await expect(uploadStash(store, "tok", async () => ({ ok: false }))).resolves.toBe(false);
  });

  it("brings custom names and favourites along without duplicates", () => {
    const out = namesFromStash(
      { custom: [{ id: "c1", n: "a" }], favs: ["ram"] },
      { custom: [{ id: "c1", n: "a" }, { id: "c2", n: "b" }], favs: ["ram", "c2"] },
    );
    expect(out.custom).toEqual([{ id: "c1", n: "a" }, { id: "c2", n: "b" }]);
    expect(out.favs).toEqual(["ram", "c2"]);
  });
});

it("a backup file never carries whose account a device belonged to", () => {
  expect(localOnly({ owner: "u1", lifetime: 3 })).toEqual({ lifetime: 3 });
});
