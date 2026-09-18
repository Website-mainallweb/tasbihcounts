import { afterEach, describe, expect, test, vi } from "vitest";

import { clearFlagCache, flagOn, flags } from "@/lib/flags";

/**
 * The kill switches, as the site reads them (docs/ADMIN.md §3.8).
 *
 * The behaviour worth testing is not "it returns the row". It is what happens
 * when the database is not there — because that is when this code runs and
 * nobody is watching, and getting it wrong turns one outage into four.
 */

vi.mock("@/lib/supabase/server", () => ({
  createAnonClient: () => ({ from: () => mockQuery() }),
}));

let mockQuery: () => Promise<{ data: unknown; error: unknown }> | { select: () => unknown };

function respond(result: { data: unknown; error: unknown }) {
  mockQuery = () => ({ select: () => Promise.resolve(result) });
}

function throwing() {
  mockQuery = () => {
    throw new Error("supabase is not configured on this build");
  };
}

afterEach(() => {
  clearFlagCache();
});

describe("when the database answers", () => {
  test("reports what it says", async () => {
    respond({ data: [{ key: "ads", enabled: false }], error: null });
    expect(await flagOn("ads")).toBe(false);
  });

  test("leaves switches it did not mention at their normal value", async () => {
    respond({ data: [{ key: "ads", enabled: false }], error: null });
    expect(await flagOn("payments")).toBe(true);
    expect(await flagOn("maintenance_mode")).toBe(false);
  });
});

describe("when it does not", () => {
  test("fails open on an error", async () => {
    respond({ data: null, error: { message: "connection refused" } });
    expect(await flagOn("payments")).toBe(true);
    expect(await flagOn("cloud_sync")).toBe(true);
  });

  test("fails open when the client throws outright", async () => {
    // What an unconfigured build does: supabaseEnv() throws MissingEnv. A
    // preview or a local run with no keys must still sell, sync and sign in.
    throwing();
    expect(await flagOn("payments")).toBe(true);
    expect(await flagOn("google_login")).toBe(true);
  });

  test("still does not show the maintenance notice", async () => {
    // The one switch whose normal value is off. Failing open here means NOT
    // telling every visitor the site is broken because a query timed out.
    throwing();
    expect(await flagOn("maintenance_mode")).toBe(false);
  });
});

describe("caching", () => {
  test("reads once for a burst of callers", async () => {
    let reads = 0;
    mockQuery = () => ({
      select: () => {
        reads += 1;
        return Promise.resolve({ data: [{ key: "ads", enabled: true }], error: null });
      },
    });

    // Ten callers arriving together — the shape of a busy moment just after the
    // cache expires, which is exactly when a query per request would hurt.
    await Promise.all(Array.from({ length: 10 }, () => flags()));
    expect(reads).toBe(1);

    // And a later caller inside the window does not read again.
    await flags();
    expect(reads).toBe(1);
  });
});
