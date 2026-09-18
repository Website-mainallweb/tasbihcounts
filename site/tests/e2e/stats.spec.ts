import { expect, test, type Page } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * The stats page, and the per-name breakdown it needed.
 *
 * That breakdown was added for the name filter and closed a real bug on the way:
 * the sync outbox used to mark the day's *total* under whichever name happened
 * to be selected, so switching name mid-day marked the same number twice and the
 * server would have summed both.
 */

/* A fixed "today" so day-relative seeding is deterministic. It is a Wednesday in
   mid-month and mid-year, so a seeded "yesterday" is always in the same
   Monday-first week (the daily view) and the same month and year — the tests
   used to fail every Monday, when yesterday fell into the previous week. The
   browser clock is pinned to it in beforeEach; dayKey computes against the same
   instant. */
const FIXED_NOW = new Date("2026-06-17T09:00:00");

function dayKey(offset: number): string {
  const d = new Date(FIXED_NOW);
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A day with the breakdown present, parts adding to the whole. */
const withNames = (parts: Record<string, number>) => {
  const n: Record<string, { c: number; r: number; s: number }> = {};
  let c = 0;
  for (const [id, count] of Object.entries(parts)) {
    n[id] = { c: count, r: Math.floor(count / 108), s: count * 1000 };
    c += count;
  }
  return { c, r: Math.floor(c / 108), s: c * 1000, n };
};

/** A day from before the breakdown existed. */
const legacy = (c: number) => ({ c, r: Math.floor(c / 108), s: c * 1000 });

async function seed(
  page: Page,
  hist: Record<string, unknown>,
  settings: Record<string, unknown> = {},
) {
  await page.addInitScript(
    ([h, more]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.clear();
      localStorage.setItem(
        "njc.v1",
        JSON.stringify({
          lifetime: 5000,
          malaDone: 20,
          nameId: "subhanallah",
          target: 108,
          hist: h,
          ...(more as Record<string, unknown>),
        }),
      );
    },
    [hist, settings] as const,
  );
}

const total = (page: Page) => page.locator(".stats .totals .t").first().locator("b");
const perDay = (page: Page) => page.locator(".stats .totals .t").nth(1).locator("b");

/* These check our own behaviour, so the ad and analytics tags are cut off — see
   third-party.ts. responsive.spec.ts keeps the real network. */
test.beforeEach(async ({ page, context }) => {
  // Pin the browser clock so day-relative seeds never cross a week/month/year
  // boundary between runs (dayKey uses the same instant).
  await page.clock.setFixedTime(FIXED_NOW);
  await blockThirdParty(page);
  context.on("page", (p) => { void blockThirdParty(p); });
});

/* No test may touch the live site: it is under AdSense review, and a hit
   from an automated run is exactly what must not reach it. */
let assertNoProductionTraffic: (() => void) | undefined;

test.beforeEach(({ page }) => {
  assertNoProductionTraffic = watchForProductionRequests(page);
});

test.afterEach(() => {
  // Optional and cleared: a test whose beforeEach never ran (a skip, a crashed
  // browser) must not fail a second time here, or reuse an earlier test's guard.
  assertNoProductionTraffic?.();
  assertNoProductionTraffic = undefined;
});

test.describe("stats", () => {
  test("adds up the week and marks today", async ({ page }) => {
    await seed(page, {
      [dayKey(0)]: withNames({ subhanallah: 216 }),
      [dayKey(-1)]: withNames({ subhanallah: 108 }),
    });
    await page.goto("/stats/");

    await expect(total(page)).toHaveText("324");
    await expect(page.locator(".stats .bars li[data-now]")).toHaveCount(1);
  });

  test("filters by name", async ({ page }) => {
    await seed(page, { [dayKey(0)]: withNames({ subhanallah: 216, astaghfirullah: 54 }) });
    await page.goto("/stats/");

    await expect(total(page)).toHaveText("270");

    await page.locator(".stats .filter select").selectOption("subhanallah");
    await expect(total(page)).toHaveText("216");

    await page.locator(".stats .filter select").selectOption("astaghfirullah");
    await expect(total(page)).toHaveText("54");
  });

  test("says when a day cannot be attributed rather than hiding it", async ({ page }) => {
    await seed(page, {
      [dayKey(0)]: withNames({ subhanallah: 216 }),
      [dayKey(-1)]: legacy(500),
    });
    await page.goto("/stats/");

    // Unfiltered, everything counts.
    await expect(total(page)).toHaveText("716");
    await expect(page.locator(".stats .note")).toHaveCount(0);

    // Filtered, the old day cannot be attributed — and the page says so instead
    // of letting the drop look like a lapse in practice.
    await page.locator(".stats .filter select").selectOption("subhanallah");
    await expect(total(page)).toHaveText("216");
    await expect(page.locator(".stats .note")).toContainText("before counts were kept per dhikr");
  });

  test("offers no filter when nothing has a breakdown", async ({ page }) => {
    await seed(page, { [dayKey(0)]: legacy(300) });
    await page.goto("/stats/");
    await expect(page.locator(".stats .filter")).toHaveCount(0);
    await expect(total(page)).toHaveText("300");
  });

  test("switches between counts and time", async ({ page }) => {
    await seed(page, { [dayKey(0)]: withNames({ subhanallah: 120 }) });
    await page.goto("/stats/");

    await expect(total(page)).toHaveText("120");
    await page.getByRole("button", { name: "Timer" }).click();
    // 120 seconds of milliseconds is two minutes.
    await expect(total(page)).toHaveText("2m");
  });

  test("changes grain and steps back, but never forward past now", async ({ page }) => {
    await seed(page, { [dayKey(-7)]: withNames({ subhanallah: 54 }), [dayKey(0)]: withNames({ subhanallah: 108 }) });
    await page.goto("/stats/");

    await expect(page.getByRole("button", { name: "Later" })).toBeDisabled();
    await page.getByRole("button", { name: "Earlier" }).click();
    await expect(page.getByRole("button", { name: "Later" })).toBeEnabled();
    // B47: nothing before the first day with chants, so no further back.
    await expect(page.getByRole("button", { name: "Earlier" })).toBeDisabled();

    await page.getByRole("button", { name: "Monthly" }).click();
    await expect(page.locator(".stats .bars li")).toHaveCount(12);

    /* #34: the span starts at the first year with practice, so a new user sees
       this year alone instead of four empty bars before it. */
    await page.getByRole("button", { name: "Yearly" }).click();
    await expect(page.locator(".stats .bars li")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Earlier" })).toBeDisabled();
  });

  test("averages over the days that have happened", async ({ page }) => {
    // Today only. Dividing by seven on any day but Sunday would understate it.
    await seed(page, { [dayKey(0)]: withNames({ subhanallah: 700 }) });
    await page.goto("/stats/");

    /* Polled, not read once. useSyncExternalStore has no value on the server, so
       the totals paint as zero and are replaced the moment the store is read on
       the client — a single read races that and fails only under load. */
    await expect
      .poll(async () => Number((await perDay(page).textContent())!.replace(/,/g, "")))
      .toBeGreaterThan(100);
    const avg = Number((await perDay(page).textContent())!.replace(/,/g, ""));
    expect(avg).toBeLessThanOrEqual(700);
  });

  test("does not write to the counter's storage", async ({ page }) => {
    await seed(page, { [dayKey(0)]: withNames({ subhanallah: 108 }) });
    await page.goto("/stats/");
    const before = await page.evaluate(() => localStorage.getItem("njc.v1"));

    await page.getByRole("button", { name: "Monthly" }).click();
    await page.locator(".stats .bars .bar").first().click();
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => localStorage.getItem("njc.v1"))).toBe(before);
    expect(await page.evaluate(() => localStorage.getItem("njc.hot"))).toBeNull();
  });
});

test.describe("the per-dhikr breakdown the counter records", () => {
  test("attributes taps to the dhikr being counted, not the day's total", async ({
    page,
  }) => {
    /*
     * The bug: markOutbox() marked the whole day under the current name. Chant
     * under two names in one day and both components carried the day's total, so
     * a server summing them would have counted the day twice.
     */
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!localStorage.getItem("njc.hot"))).toBe(true);
    await expect(page.getByRole("button", { name: /^Count SubhanAllah. Currently/ })).toBeVisible();

    // Space is a tap; spaced past the counter's 40ms de-bounce.
    const tap = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await page.keyboard.press("Space");
        await page.waitForTimeout(45);
      }
    };

    await tap(5);
    // The quick chips above the ring switch the dhikr.
    await page.getByRole("button", { name: "Astaghfirullah", exact: true }).first().click();
    await expect(page.getByRole("button", { name: /^Count Astaghfirullah. Currently/ })).toBeVisible();
    await tap(3);

    const hot = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("njc.hot") || "null"),
    );

    // The day holds eight; the two names hold five and three.
    expect(hot.rec.c).toBe(8);
    const parts = Object.values(hot.rec.n) as { c: number }[];
    expect(parts.map((p) => p.c).sort()).toEqual([3, 5]);
    expect(parts.reduce((n, p) => n + p.c, 0)).toBe(hot.rec.c);

    // And the outbox carries the component, not the total — two entries, one
    // per name, adding to the day rather than each claiming all of it.
    const entries = Object.values(hot.outbox) as { c: number; naamId: string }[];
    expect(entries).toHaveLength(2);
    expect(entries.reduce((n, e) => n + e.c, 0)).toBe(8);
  });
});

test("speaks Hindi when the counter is set to Hindi", async ({ page }) => {
  // Same practice, same language as the ring it was counted on (#16/#29).
  await seed(page, { [dayKey(0)]: { c: 108, r: 1, s: 300_000 } }, {
    lang: "hi",
    numerals: "deva",
  });
  await page.goto("/stats/");

  await expect(page.locator(".stats h1")).toHaveText("जप के आँकड़े");
  await expect(total(page)).toHaveText("१०८");
  await expect(page.locator(".stats .bars .lb").first()).toHaveText("सोम");
  await expect(page.locator('button[aria-label="पहले"]')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
});
