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

const tap = async (page: Page, times = 1) => {
  await page.evaluate((n) => {
    const s = document.getElementById("njcSurface")!;
    for (let i = 0; i < n; i++) {
      s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 300 }));
      s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 200, clientY: 300 }));
    }
  }, times);
};

/** As in counter.spec.ts: the row's own click handler, not a synthetic tap. */
async function pickAName(page: Page) {
  await page.evaluate(() => {
    document.getElementById("njcSelectBar")!.click();
  });
  await page.waitForSelector("#njcAllList [data-id]");
  await page.evaluate(() => {
    (document.querySelector("#njcAllList [data-id]") as HTMLElement).click();
    (document.querySelector("#shName [data-close]") as HTMLElement | null)?.click();
  });
  await expect(page.locator("#njc")).not.toHaveClass(/njc-noname/);
}

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
    await pickAName(page);
    await tap(page);
    await expect(page.locator("#njcToday")).toHaveText("1");
    await expect(errorScreen(page)).toHaveCount(0);
  });
});

test.describe("storage allowed", () => {
  test("still persists across a reload", async ({ page }) => {
    await page.goto("/");
    await pickAName(page);
    await tap(page, 3);
    await expect(page.locator("#njcToday")).toHaveText("3");

    await page.reload();
    await expect(page.locator("#njcToday")).toHaveText("3");
    expect(
      await page.evaluate(() => localStorage.getItem("njc.hot")),
    ).not.toBeNull();
  });
});
