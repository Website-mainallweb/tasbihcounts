import { expect, test, type Page } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * The browser refusing the `localStorage` property itself.
 *
 * Not the same thing as a refused `getItem`: some embedded and locked-down
 * contexts throw on the property access, which happened before any of the
 * wrapper's guards could run. It escaped to React, and every page — counter,
 * Streak, Stats, all of them mount the header hook — came up as the Next.js
 * error screen instead of the site. A counter that cannot remember must still
 * count, so none of these pages may fail this way.
 */
const DENY_STORAGE = () => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("Access denied to localStorage", "SecurityError");
    },
  });
};

/** Space is a tap; spaced past the counter's 40ms de-bounce. */
const tap = async (page: Page, times = 1) => {
  await expect(page.getByRole("button", { name: /^Count .*Currently/ })).toBeVisible();
  for (let i = 0; i < times; i++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(45);
  }
};

/** The count on the ring. */
const ring = (page: Page) => page.locator("#njcDigits").first();

/** Today, as the practice panel shows it. */
const today = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("njc.hot") || "null")?.rec?.c ?? 0);

/** The error screen's own root id — the one signature that cannot be faked. */
const errorScreen = (page: Page) => page.locator("html#__next_error__");

test.beforeEach(async ({ page, context }) => {
  await blockThirdParty(page);
  context.on("page", (p) => { void blockThirdParty(p); });
});

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

test.describe("storage denied at the property", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(DENY_STORAGE);
  });

  for (const path of ["/", "/streak", "/stats"]) {
    test(`${path} renders the page, not the error screen`, async ({ page }) => {
      await page.goto(path);
      await expect(errorScreen(page)).toHaveCount(0);
      await expect(page.locator("header.site-header")).toBeVisible();
    });
  }

  test("the counter still counts with nowhere to save", async ({ page }) => {
    await page.goto("/");
    await tap(page);
    await expect(ring(page)).toHaveText("1");
    await expect(errorScreen(page)).toHaveCount(0);
  });
});

test.describe("storage allowed", () => {
  test("still persists across a reload", async ({ page }) => {
    await page.goto("/");
    await tap(page, 3);
    await expect.poll(() => today(page)).toBe(3);

    await page.reload();
    await expect(page.getByRole("button", { name: /^Count .*Currently/ })).toBeVisible();
    await expect.poll(() => today(page)).toBe(3);
  });
});
