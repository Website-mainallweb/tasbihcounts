import { expect, test, type Page } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * The Tasbih counter and the ledger under it, in a real browser on the
 * production build.
 *
 * The counter draws; the ledger (src/lib/counter/ledger.ts) keeps the record the
 * Stats and Streak pages read and the account sync sends. What these check is
 * the wiring between the two — a tap on the ring reaching njc.hot under the right
 * dhikr — which no unit test covers.
 */

/** Count by keyboard: Space is a tap. Spaced out past the counter's 40ms de-bounce. */
const tap = async (page: Page, times = 1) => {
  for (let i = 0; i < times; i++) await page.keyboard.press("Space", { delay: 5 }).then(() => page.waitForTimeout(45));
};

const hot = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("njc.hot") || "null"));

/** The ledger is running once it has written this installation's hot record. */
const ready = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem("njc.hot"))).toBe(true);
  await expect(page.getByRole("button", { name: /^Count .*Currently/ })).toBeVisible();
};

test.beforeEach(async ({ page, context }) => {
  await blockThirdParty(page);
  context.on("page", (p) => {
    void blockThirdParty(p);
  });
});

let assertNoProductionTraffic: (() => void) | undefined;

test.beforeEach(({ page }) => {
  assertNoProductionTraffic = watchForProductionRequests(page);
});

test.afterEach(() => {
  assertNoProductionTraffic?.();
  assertNoProductionTraffic = undefined;
});

test.describe("the counter", () => {
  test("runs in the browser, not just as server HTML", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/");
    await ready(page);

    // The stylesheet arrived: the tap surface is laid out, not an inline button.
    const display = await page
      .getByRole("button", { name: /^Count .*Currently/ })
      .evaluate((el) => getComputedStyle(el).display);
    expect(display).not.toBe("inline-block");

    expect(errors).toEqual([]);
  });

  test("records every tap in the ledger, under the dhikr being counted", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await tap(page, 3);

    const h = await hot(page);
    expect(h.v).toBe(2);
    expect(h.sourceId).toBeTruthy();
    expect(h.rec.c).toBe(3);
    expect(h.rec.n.subhanallah.c).toBe(3);

    // What a tap rewrites does not grow with history.
    const size = await page.evaluate(() => localStorage.getItem("njc.hot")!.length);
    expect(size).toBeLessThan(600);
  });

  test("marks the outbox under a day-and-dhikr key", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await tap(page, 4);

    const h = await hot(page);
    const keys = Object.keys(h.outbox);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^\d{4}-\d{2}-\d{2}\|subhanallah$/);
    expect(h.outbox[keys[0]].c).toBe(4);
  });

  test("a completed target is a round, and undo takes it back", async ({ page }) => {
    // rec.r decides the streak, so leaving it credited after an undo would hand
    // out a day that was not practised. SubhanAllah's default target is 33.
    await page.goto("/");
    await ready(page);
    await tap(page, 33);
    expect((await hot(page)).rec).toMatchObject({ c: 33, r: 1 });

    // The completion card may be up; undo is still Z.
    await page.keyboard.press("z");
    await expect.poll(async () => (await hot(page)).rec).toMatchObject({ c: 32, r: 0 });
  });

  test("the numbers survive a reload", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await tap(page, 5);
    await page.reload();
    await ready(page);

    await expect.poll(async () => (await hot(page)).rec.c).toBe(5);
    await expect(page.locator('#njc [data-stat="today"]:visible').first()).toHaveText("5");
  });

  test("a guided routine credits each step to its own dhikr", async ({ page }) => {
    await page.goto("/?r=after-salah-33-33-34");
    await ready(page);
    await tap(page, 34);

    const n = (await hot(page)).rec.n;
    expect(n.subhanallah.c).toBe(33);
    expect(n.alhamdulillah.c).toBe(1);
    // Finishing the first step completed a round.
    expect(n.subhanallah.r).toBe(1);
  });

  test("a finished routine does not overwrite the plain dhikr's count", async ({ page }) => {
    // The routine's state carries its first step's dhikr id; saved as that
    // dhikr's snapshot, SubhanAllah reopened at 1 instead of where it was left.
    await page.goto("/");
    await ready(page);
    await tap(page, 5);
    await page.waitForTimeout(600);

    await page.goto("/?r=after-salah-33-33-34");
    await ready(page);
    await tap(page, 34);
    await page.waitForTimeout(600);

    await page.goto("/?d=subhanallah");
    await ready(page);
    await expect(page.locator("#njcDigits").first()).toHaveText("5");
  });

  test("the Library link opens the dhikr sheet", async ({ page }) => {
    await page.goto("/#library");
    await expect(page.getByRole("dialog", { name: /choose dhikr/i })).toBeVisible();
    // The hash described an action and is gone once it has happened.
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  });
});

test.describe("counter storage", () => {
  test("keeps the pre-split state as a backup and never deletes it", async ({ page }) => {
    // Seeded before anything runs: a reload would let pagehide write the split
    // keys first, and the legacy key would never be read.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.clear();
      localStorage.setItem(
        "njc.v1",
        JSON.stringify({
          lifetime: 500,
          nameId: "subhanallah",
          hist: { "2026-01-01": { c: 100, r: 1, s: 60000 } },
        }),
      );
    });
    await page.goto("/");

    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).sort()))
      .toContain("njc.legacy_v1");

    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(keys).toContain("njc.v1");
    expect(keys).toContain("njc.hot");
    await expect.poll(async () => (await hot(page)).fields.lifetime).toBe(500);
  });
});
