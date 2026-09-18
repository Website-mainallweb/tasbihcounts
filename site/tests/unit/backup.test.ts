import { describe, expect, it } from "vitest";

import {
  MAX_HISTORY_ENTRIES,
  MAX_TEXT,
  alreadyImported,
  isDayKey,
  localOnly,
  makeBackup,
  mergeBackup,
  parseBackup,
  rememberImport,
  sanitiseState,
} from "../../src/lib/counter/backup";
import type { State } from "../../src/lib/counter/storage";

/** Stands in for the engine's BLANK. */
const BLANK: Record<string, unknown> = {
  nameId: null,
  count: 0,
  target: 108,
  rounds: null,
  malaDone: 0,
  lifetime: 0,
  mode: "up",
  hist: {},
  lastDay: "",
  theme: "prabhat",
  lang: "en",
  vibration: false,
  custom: [],
  favs: [],
};

const base = (o: Partial<State> = {}): State => ({
  ...BLANK,
  lifetime: 1000,
  malaDone: 5,
  hist: {
    "2026-09-01": { c: 108, r: 1, s: 300 },
    "2026-09-02": { c: 216, r: 2, s: 600 },
  },
  ...o,
});

describe("isDayKey", () => {
  it("accepts a real date", () => {
    expect(isDayKey("2026-09-09")).toBe(true);
    expect(isDayKey("2024-02-29")).toBe(true);
  });

  it("rejects shapes that only look like dates", () => {
    for (const k of [
      "2026-99-99",
      "2026-02-30",
      "2023-02-29",
      "2026-9-9",
      "not-a-date",
      "",
      "2026-09-09T00:00:00Z",
    ]) {
      expect(isDayKey(k), k).toBe(false);
    }
  });
});

describe("mergeBackup — the bug this phase exists to fix", () => {
  it("does not delete days the file has never heard of", () => {
    // The old import assigned state straight from the file. Restoring this
    // backup used to wipe every day after 2026-09-02.
    const local = base({
      hist: {
        "2026-09-01": { c: 108, r: 1, s: 300 },
        "2026-09-02": { c: 216, r: 2, s: 600 },
        "2026-09-08": { c: 540, r: 5, s: 1500 },
        "2026-09-09": { c: 108, r: 1, s: 300 },
      },
      lifetime: 2000,
    });
    const old = base();

    const { state } = mergeBackup(local, old);
    expect(Object.keys(state.hist!).sort()).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-08",
      "2026-09-09",
    ]);
    expect(state.lifetime).toBe(2000);
  });

  it("brings back days the local install has lost", () => {
    const local = base({ hist: {}, lifetime: 0 });
    const { state, daysAdded } = mergeBackup(local, base());
    expect(daysAdded).toBe(2);
    expect(state.hist!["2026-09-01"]).toEqual({ c: 108, r: 1, s: 300 });
    expect(state.lifetime).toBe(1000);
  });

  it("takes the larger value per field where a day exists on both sides", () => {
    const local = base({ hist: { "2026-09-01": { c: 200, r: 1, s: 100 } } });
    const file = base({ hist: { "2026-09-01": { c: 108, r: 3, s: 900 } } });
    const { state } = mergeBackup(local, file);
    expect(state.hist!["2026-09-01"]).toEqual({ c: 200, r: 3, s: 900 });
  });

  it("raises lifetime to cover the days the merge brought in", () => {
    // Restoring a backup full of forgotten days used to add them to the history
    // and leave the headline total untouched, so the number on screen no longer
    // matched the days behind it.
    const local = base({ hist: { "2026-09-09": { c: 23, r: 0, s: 0 } }, lifetime: 23 });
    const file = base({
      hist: { "2026-06-01": { c: 540, r: 5, s: 900_000 } },
      lifetime: 2,
    });
    const { state } = mergeBackup(local, file);
    expect(state.lifetime).toBe(563);
  });

  it("keeps a lifetime larger than the history it can see", () => {
    // History can be shorter than the practice — a truncated import, or a total
    // carried over from before day records existed. Lifetime must never fall.
    const local = base({ hist: { "2026-09-09": { c: 10, r: 0, s: 0 } }, lifetime: 90_000 });
    const { state } = mergeBackup(local, base({ hist: {}, lifetime: 0 }));
    expect(state.lifetime).toBe(90_000);
  });

  it("never lowers a number, whatever the file says", () => {
    const local = base({ lifetime: 5000, malaDone: 40 });
    const { state } = mergeBackup(local, base({ lifetime: 1, malaDone: 0 }));
    expect(state.lifetime).toBe(5000);
    expect(state.malaDone).toBe(40);
  });

  it("is idempotent — importing the same file twice changes nothing", () => {
    const file = base();
    const once = mergeBackup(base({ hist: {}, lifetime: 0 }), file).state;
    const twice = mergeBackup(once, file).state;
    expect(twice).toEqual(once);
  });

  it("does not add, because adding would double every shared day", () => {
    const file = base();
    const { state } = mergeBackup(base(), file);
    expect(state.hist!["2026-09-02"].c).toBe(216);
    expect(state.lifetime).toBe(1000);
  });

  it("leaves settings alone", () => {
    const local = base({ theme: "raat", lang: "gu", target: 21 });
    const { state } = mergeBackup(local, base({ theme: "prabhat", lang: "en", target: 108 }));
    expect(state.theme).toBe("raat");
    expect(state.lang).toBe("gu");
    expect(state.target).toBe(21);
  });

  it("unions custom names and favourites", () => {
    const local = base({
      custom: [{ id: "a", n: "एक", t: "Ek", m: "" }],
      favs: ["ram"],
    });
    const file = base({
      custom: [
        { id: "a", n: "different", t: "x", m: "" },
        { id: "b", n: "दो", t: "Do", m: "" },
      ],
      favs: ["shiva"],
    });
    const { state, namesAdded } = mergeBackup(local, file);
    expect(namesAdded).toBe(1);
    // The local copy of a shared id wins; the file's new one is added.
    expect(state.custom).toEqual([
      { id: "a", n: "एक", t: "Ek", m: "" },
      { id: "b", n: "दो", t: "Do", m: "" },
    ]);
    expect((state.favs as string[]).sort()).toEqual(["ram", "shiva"]);
  });

  it("reports what changed", () => {
    const local = base({ hist: { "2026-09-01": { c: 10, r: 0, s: 0 } } });
    const r = mergeBackup(local, base());
    expect(r.daysAdded).toBe(1);
    expect(r.daysRaised).toBe(1);
  });
});

describe("sanitiseState — a backup file is untrusted input", () => {
  it("drops keys the blank shape has never heard of", () => {
    const s = sanitiseState({ ...base(), evil: "x", __proto__: { y: 1 } }, BLANK);
    expect(s).not.toHaveProperty("evil");
  });

  it("pins types, so a string where a number belongs cannot get in", () => {
    const s = sanitiseState({ ...base(), lifetime: "lots", count: [] }, BLANK);
    expect(s.lifetime).toBe(0);
    expect(s.count).toBe(0);
  });

  it("refuses negative and non-finite counts", () => {
    const s = sanitiseState(
      { ...base(), lifetime: -5, malaDone: Number.POSITIVE_INFINITY },
      BLANK,
    );
    expect(s.lifetime).toBe(0);
    expect(s.malaDone).toBe(0);
  });

  it("keeps nullable fields null and coerces the rest", () => {
    const s = sanitiseState({ ...base(), target: null, rounds: null }, BLANK);
    expect(s.target).toBeNull();
    expect(s.rounds).toBeNull();
  });

  it("throws away history keys that are not real dates", () => {
    const s = sanitiseState(
      {
        ...base(),
        hist: {
          "2026-09-01": { c: 1, r: 0, s: 0 },
          "2026-99-99": { c: 9, r: 9, s: 9 },
          nonsense: { c: 9, r: 9, s: 9 },
        },
      },
      BLANK,
    );
    expect(Object.keys(s.hist!)).toEqual(["2026-09-01"]);
  });

  it("repairs a malformed day record instead of trusting it", () => {
    const s = sanitiseState(
      { ...base(), hist: { "2026-09-01": { c: "12", r: null, s: -3 } } },
      BLANK,
    );
    expect(s.hist!["2026-09-01"]).toEqual({ c: 12, r: 0, s: 0 });
  });

  it("caps history so one file cannot bury the browser", () => {
    const hist: Record<string, unknown> = {};
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 500; i++) {
      const d = new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10);
      hist[d] = { c: 1, r: 0, s: 0 };
    }
    const s = sanitiseState({ ...base(), hist }, BLANK);
    expect(Object.keys(s.hist!).length).toBeLessThanOrEqual(MAX_HISTORY_ENTRIES);
  });

  it("caps custom mantra text so one entry cannot fill the library", () => {
    const s = sanitiseState(
      { ...base(), custom: [{ id: "a", n: "क".repeat(1000), t: "", m: "" }] },
      BLANK,
    );
    expect((s.custom as { n: string }[])[0].n.length).toBe(MAX_TEXT);
  });

  it("drops custom entries with no name", () => {
    const s = sanitiseState(
      { ...base(), custom: [{ id: "a", n: "", t: "x", m: "" }, "junk", 42] },
      BLANK,
    );
    expect(s.custom).toEqual([]);
  });

  it("copes with rubbish where an object belongs", () => {
    expect(() => sanitiseState(null, BLANK)).not.toThrow();
    expect(() => sanitiseState("hello", BLANK)).not.toThrow();
    expect(sanitiseState([], BLANK).lifetime).toBe(0);
  });
});

describe("parseBackup", () => {
  it("reads a version 2 file and its provenance", () => {
    const file = JSON.stringify(
      makeBackup(base(), {
        sourceId: "src-1",
        backupId: "b-1",
        now: new Date("2026-09-09T10:00:00Z"),
      }),
    );
    const { meta, state } = parseBackup(file, BLANK);
    expect(meta).toEqual({
      version: 2,
      backupId: "b-1",
      sourceId: "src-1",
      createdAt: "2026-09-09T10:00:00.000Z",
    });
    expect(state.lifetime).toBe(1000);
  });

  it("still reads a version 1 file — the bare state, no wrapper", () => {
    const { meta, state } = parseBackup(JSON.stringify(base()), BLANK);
    expect(meta.version).toBe(1);
    expect(meta.backupId).toBe("");
    expect(state.lifetime).toBe(1000);
  });

  it("refuses text that is not a backup", () => {
    expect(() => parseBackup("{oops", BLANK)).toThrow("not-json");
    expect(() => parseBackup("[]", BLANK)).toThrow("not-an-object");
    expect(() => parseBackup('{"hello":1}', BLANK)).toThrow("not-a-backup");
  });

  it("round-trips through export and import", () => {
    const before = base();
    const file = JSON.stringify(
      makeBackup(before, { sourceId: "s", backupId: "b" }),
    );
    const { state } = parseBackup(file, BLANK);
    expect(state.hist).toEqual(before.hist);
    expect(state.lifetime).toBe(before.lifetime);
  });
});

describe("import provenance", () => {
  it("recognises a file it has already taken in", () => {
    const s = rememberImport(base(), "b-1");
    expect(alreadyImported(s, "b-1")).toBe(true);
    expect(alreadyImported(s, "b-2")).toBe(false);
  });

  it("does not record the same id twice", () => {
    const s = rememberImport(rememberImport(base(), "b-1"), "b-1");
    expect(s.importedBackups).toEqual(["b-1"]);
  });

  it("ignores a version 1 file, which carries no id", () => {
    const s = rememberImport(base(), "");
    expect(s.importedBackups).toBeUndefined();
    expect(alreadyImported(s, "")).toBe(false);
  });

  it("keeps the list bounded", () => {
    let s = base();
    for (let i = 0; i < 80; i++) s = rememberImport(s, `b-${i}`);
    expect((s.importedBackups as string[]).length).toBe(50);
    expect(alreadyImported(s, "b-79")).toBe(true);
  });
});

describe("what a backup file carries", () => {
  it("leaves other devices' counts and the sync bookkeeping behind", () => {
    const state: State = {
      lifetime: 500,
      hist: { "2026-09-01": { c: 500, r: 4, s: 60_000 } },
      others: { devices: { "2026-09-01": { ram: { c: 300, r: 2, s: 0 } } }, history: {} },
      syncFrom: "2026-09-01",
      historyUploaded: true,
    };
    const blob = makeBackup(localOnly(state), { sourceId: "s", backupId: "b" });
    expect(blob.state).toEqual({ lifetime: 500, hist: { "2026-09-01": { c: 500, r: 4, s: 60_000 } } });
    // The live state itself is untouched.
    expect(state.others).toBeDefined();
  });
});
