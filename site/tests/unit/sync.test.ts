import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { combinedHistory, emptyOthers, extraLifetime, mergeOthers, readOthers } from "../../src/lib/counter/combine";
import type { Entry } from "../../src/lib/counter/outbox";
import { createSyncClient, hasSessionCookie, IDLE_MS, STALE_MS, type SyncHooks } from "../../src/lib/counter/sync-client";
import { allow, resetRateLimits } from "../../src/lib/rate-limit";
import { HISTORY_SOURCE, planSync, PullRequest, SyncRequest, type SyncEntry } from "../../src/lib/sync/schema";

/**
 * Sync (ARCHITECTURE §1, §4, SPEC §6 revised, Phase 10). The invariants that matter:
 *   - a device shows its own count plus other devices', and uploads only its own
 *   - shared pre-sync history is compared with a device's own record, never added
 *   - an entry clears only when the server confirmed the version that was sent
 *   - a bad day or shape is refused, not retried forever, and does not sink the batch
 *   - a free user's counter never loads the sync client
 */

describe("combining this device with everyone else", () => {
  const hist = {
    "2026-09-09": { c: 108, r: 1, s: 600_000, n: { ram: { c: 108, r: 1, s: 600_000 } } },
    "2026-09-10": { c: 20, r: 0, s: 60_000, n: { ram: { c: 20, r: 0, s: 60_000 } } },
  };

  test("other devices' counts are added, per day and per name", () => {
    const others = readOthers({
      devices: { "2026-09-10": { ram: { c: 30, r: 0, s: 90_000 }, shiva: { c: 108, r: 1, s: 300_000 } } },
    });
    const view = combinedHistory(hist, others);
    expect(view["2026-09-10"]).toEqual({
      c: 158,
      r: 1,
      s: 450_000,
      n: { ram: { c: 50, r: 0, s: 150_000 }, shiva: { c: 108, r: 1, s: 300_000 } },
    });
    expect(view["2026-09-09"].c).toBe(108);
  });

  test("shared history is compared with this device's own record, never added to it", () => {
    // This device uploaded its own 2026-09-09 as history; the server hands it back.
    const others = readOthers({ history: { "2026-09-09": { ram: { c: 108, r: 1, s: 600_000 } } } });
    expect(combinedHistory(hist, others)["2026-09-09"].c).toBe(108); // not 216
  });

  test("a restored backup on a second device does not double a day", () => {
    // The laptop restored the phone's backup and uploaded the same 108 as history;
    // GREATEST kept one 108 on the server. The phone sees 108, not 216.
    const others = readOthers({ history: { "2026-09-09": { ram: { c: 108, r: 1, s: 600_000 } } } });
    expect(combinedHistory(hist, others)["2026-09-09"]).toMatchObject({ c: 108, r: 1 });
  });

  test("history this device never had still shows", () => {
    const others = readOthers({ history: { "2026-08-01": { krishna: { c: 21, r: 0, s: 0 } } } });
    expect(combinedHistory(hist, others)["2026-08-01"].c).toBe(21);
  });

  test("never changes this device's own history, which is what gets uploaded", () => {
    const before = JSON.stringify(hist);
    combinedHistory(hist, readOthers({ devices: { "2026-09-10": { ram: { c: 1, r: 0, s: 0 } } } }));
    expect(JSON.stringify(hist)).toBe(before);
  });

  test("extraLifetime is exactly what the view adds", () => {
    const others = readOthers({
      devices: { "2026-09-10": { ram: { c: 30, r: 0, s: 0 } } },
      history: { "2026-09-09": { ram: { c: 108, r: 1, s: 0 } }, "2026-08-01": { ram: { c: 21, r: 0, s: 0 } } },
    });
    expect(extraLifetime(hist, others)).toBe(51);
  });

  test("the server's sums replace the days they cover, in both kinds, and leave the rest", () => {
    const current = readOthers({
      devices: {
        "2026-09-10": { ram: { c: 5, r: 0, s: 0 }, shiva: { c: 9, r: 0, s: 0 } },
        "2026-09-11": { ram: { c: 1, r: 0, s: 0 } },
      },
      history: { "2026-09-10": { ram: { c: 7, r: 0, s: 0 } } },
    });
    const next = mergeOthers(
      current,
      [{ day: "2026-09-10", naamId: "ram", kind: "devices", c: 40, r: 0, s: 1 }],
      ["2026-09-10"],
    );
    expect(next.devices["2026-09-10"]).toEqual({ ram: { c: 40, r: 0, s: 1 } });
    expect(next.history["2026-09-10"]).toBeUndefined();
    expect(next.devices["2026-09-11"]).toEqual(current.devices["2026-09-11"]);
    expect(mergeOthers(current, [], "all")).toEqual(emptyOthers());
  });

  test("garbage in storage is ignored, not trusted", () => {
    expect(readOthers({ devices: { "not-a-day": { ram: { c: 5 } }, "2026-09-10": { ram: { c: -4, r: "x" } } } })).toEqual({
      devices: { "2026-09-10": { ram: { c: 0, r: 0, s: 0 } } },
      history: {},
    });
    expect(readOthers([1, 2])).toEqual(emptyOthers());
  });
});

describe("planSync and the request shape", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const e = (over: Partial<SyncEntry>): SyncEntry => ({ day: "2026-09-10", naamId: "ram", c: 10, r: 0, s: 0, version: 1, ...over });

  test("keeps good entries and refuses the rest with a reason", () => {
    const { valid, rejected } = planSync(
      [
        e({}),
        e({ day: "2026-09-11", naamId: "a" }), // one day ahead: fine
        e({ day: "2026-09-12", naamId: "b" }), // two ahead: clock
        e({ day: "2021-09-09", naamId: "c" }), // over five years back: clock
        e({ day: "2026-02-31", naamId: "d" }), // not a real date
        e({ naamId: "f", c: 1, r: 2 }), // more rounds than taps
      ],
      now,
    );
    expect(valid.map((v) => v.naamId)).toEqual(["ram", "a"]);
    expect(rejected).toEqual([
      { key: "2026-09-12|b", reason: "clock" },
      { key: "2021-09-09|c", reason: "clock" },
      { key: "2026-02-31|d", reason: "shape" },
      { key: "2026-09-10|f", reason: "shape" },
    ]);
  });

  test("the same key twice keeps the newer version", () => {
    const { valid } = planSync([e({ version: 3, c: 30 }), e({ version: 2, c: 20 })], now);
    expect(valid).toEqual([e({ version: 3, c: 30 })]);
  });

  test("no installation may sync or pull as the shared history source", () => {
    expect(SyncRequest.safeParse({ sourceId: HISTORY_SOURCE, entries: [] }).success).toBe(false);
    expect(PullRequest.safeParse({ sourceId: HISTORY_SOURCE }).success).toBe(false);
    expect(SyncRequest.parse({ sourceId: "abc", entries: [] }).kind).toBe("device");
    expect(SyncRequest.parse({ sourceId: "abc", kind: "history", entries: [] }).kind).toBe("history");
  });
});

describe("the rate limit", () => {
  beforeEach(() => resetRateLimits());

  test("allows up to the limit in a window, then refuses, then resets", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(allow("u", 3, 60_000, t)).toBe(true);
    expect(allow("u", 3, 60_000, t + 1)).toBe(false);
    expect(allow("other", 3, 60_000, t + 1)).toBe(true);
    expect(allow("u", 3, 60_000, t + 60_000)).toBe(true);
  });
});

describe("the sync client", () => {
  let clock = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  let outbox: Entry[] = [];
  let leader = true;
  const results: unknown[][] = [];
  const pulls: unknown[] = [];
  let notPremium = 0;

  const entry = (over: Partial<Entry> = {}): Entry => ({ day: "2026-09-10", naamId: "ram", c: 5, r: 0, s: 0, version: 1, ...over });

  const hooks: SyncHooks = {
    pending: () => outbox,
    sourceId: () => "src-1",
    canSync: () => leader,
    onResult: (acks, rejected, others, days) => {
      results.push([acks, rejected, others, days]);
      outbox = outbox.filter((o) => !acks.some((a) => a.key === `${o.day}|${o.naamId}` && a.version === o.version));
    },
    onPull: (others) => pulls.push(others),
    onNotPremium: () => {
      notPremium += 1;
    },
  };

  function advance(ms: number) {
    clock += ms;
    for (const t of timers.filter((x) => x.at <= clock).sort((a, b) => a.at - b.at)) {
      timers = timers.filter((x) => x.id !== t.id);
      t.fn();
    }
  }

  function client(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, token: string | null = "tok") {
    const fetchSpy = vi.fn(fetchImpl);
    const c = createSyncClient(hooks, {
      getToken: async () => token,
      fetch: fetchSpy as unknown as typeof fetch,
      now: () => clock,
      setTimeout: (fn, ms) => {
        const id = nextId++;
        timers.push({ at: clock + ms, fn, id });
        return id;
      },
      clearTimeout: (id) => {
        timers = timers.filter((x) => x.id !== id);
      },
    });
    return { c, fetchSpy };
  }

  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    clock = 1_000_000;
    timers = [];
    outbox = [];
    leader = true;
    results.length = 0;
    pulls.length = 0;
    notPremium = 0;
  });

  afterEach(() => vi.restoreAllMocks());

  test("waits for 10 seconds of quiet, then sends the entries with a bearer token", async () => {
    const { c, fetchSpy } = client(() =>
      ok({ acks: [{ key: "2026-09-10|ram", version: 1, confirmed: { c: 5, r: 0, s: 0 } }], rejected: [], others: [] }),
    );
    outbox = [entry()];
    c.changed();
    advance(IDLE_MS - 1);
    expect(fetchSpy).not.toHaveBeenCalled();
    advance(1);
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/sync/");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toMatchObject({
      sourceId: "src-1",
      entries: [{ day: "2026-09-10", naamId: "ram", c: 5, version: 1 }],
    });
    expect(outbox).toEqual([]);
  });

  test("steady tapping still sends within 60 seconds", async () => {
    const { c, fetchSpy } = client(() => ok({ acks: [], rejected: [], others: [] }));
    outbox = [entry()];
    for (let t = 0; t < STALE_MS; t += 5_000) {
      c.changed();
      advance(5_000);
    }
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalled();
  });

  test("a hidden page flushes at once, with keepalive", async () => {
    const { c, fetchSpy } = client(() => ok({ acks: [], rejected: [], others: [] }));
    outbox = [entry()];
    await c.flushNow({ keepalive: true });
    expect(fetchSpy.mock.calls[0][1].keepalive).toBe(true);
  });

  test("an entry that changed mid-flight stays and goes again", async () => {
    const { c, fetchSpy } = client(() => {
      outbox = [entry({ c: 9, version: 2 })]; // a tap landed while the request was out
      return ok({ acks: [{ key: "2026-09-10|ram", version: 1, confirmed: { c: 5, r: 0, s: 0 } }], rejected: [], others: [] });
    });
    outbox = [entry()];
    await c.flushNow();
    expect(outbox).toEqual([entry({ c: 9, version: 2 })]);
    advance(IDLE_MS);
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("nothing is sent while syncing is switched off", async () => {
    const { c, fetchSpy } = client(() => ok({}));
    leader = false;
    outbox = [entry()];
    await c.flushNow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a browser that is not signed in sends nothing", async () => {
    const { c, fetchSpy } = client(() => ok({}), null);
    outbox = [entry()];
    await c.flushNow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a failure backs off and retries", async () => {
    let calls = 0;
    const { c, fetchSpy } = client(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("offline")) : ok({ acks: [], rejected: [], others: [] });
    });
    outbox = [entry()];
    await c.flushNow();
    advance(4_999);
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    advance(1);
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("403 means no Premium: sync stops and the engine is told", async () => {
    const { c, fetchSpy } = client(() => Promise.resolve(new Response("{}", { status: 403 })));
    outbox = [entry()];
    await c.flushNow();
    expect(notPremium).toBe(1);
    expect(c.stopped).toBe(true);
    await c.flushNow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("pull hands everyone else's totals to the engine", async () => {
    const rows = [{ day: "2026-09-10", naamId: "ram", kind: "devices", c: 3, r: 0, s: 0 }];
    const { c } = client(() => ok({ others: rows }));
    await c.pull();
    expect(pulls).toEqual([rows]);
  });

  test("history goes up once, in batches of 200, marked as history, without touching the outbox", async () => {
    const bodies: { kind: string; entries: unknown[] }[] = [];
    const { c } = client((_u, init) => {
      bodies.push(JSON.parse(init.body as string));
      return ok({ acks: [], rejected: [], others: [] });
    });
    outbox = [entry()];
    const history = Array.from({ length: 450 }, (_, i) => entry({ day: "2026-01-01", naamId: `n${i}` }));
    expect(await c.sendHistory(history)).toBe(true);
    expect(bodies.map((b) => [b.kind, b.entries.length])).toEqual([
      ["history", 200],
      ["history", 200],
      ["history", 50],
    ]);
    expect(outbox).toEqual([entry()]);
    expect(results).toEqual([]);
  });

  test("a history batch that fails reports it, so the upload is tried again later", async () => {
    const { c } = client(() => Promise.resolve(new Response("{}", { status: 503 })));
    expect(await c.sendHistory([entry()])).toBe(false);
  });

  test("the session cookie is recognised without loading Supabase, chunks included", () => {
    const url = "https://abcd1234.supabase.co";
    expect(hasSessionCookie("a=1; sb-abcd1234-auth-token=base64-xyz", url)).toBe(true);
    expect(hasSessionCookie("sb-abcd1234-auth-token.0=base64-xyz; b=2", url)).toBe(true);
    expect(hasSessionCookie("sb-other-auth-token=x", url)).toBe(false);
    expect(hasSessionCookie("", url)).toBe(false);
    expect(hasSessionCookie("sb-abcd1234-auth-token=x", undefined)).toBe(false);
  });
});
