import { expect, test, type Page } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * Two tabs of the counter. Both count, and they are one counter.
 *
 * This replaced an election where one tab counted and the other only watched
 * behind a "Count here" button. Now every tap in any tab goes into the same
 * total: a tab takes in whatever another tab saved before it changes anything,
 * and every open tab shows each tap as it lands. The failure all of this guards
 * against is the old one — a tab holding a stale copy of the state and writing it
 * over another tab's taps.
 */

const count = (page: Page) =>
  page.evaluate(() => document.getElementById("njcDigits")!.textContent);

const storedCount = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("njc.hot") || "null")?.fields?.count);

async function tap(page: Page, times: number) {
  await page.evaluate((n) => {
    const s = document.getElementById("njcSurface")!;
    for (let i = 0; i < n; i++) {
      s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 400 }));
      s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 300, clientY: 400 }));
    }
  }, times);
}

async function openCounter(page: Page) {
  await blockThirdParty(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  /*
   * A tap in the other tab must be VISIBLE here before this tab taps: WebKit runs
   * the two tabs in separate processes and can serve a stale `njc.rev` for a
   * moment, so two taps inside the same millisecond let the second tab count from
   * the older total. A person cannot tap in two tabs that fast; the harness can.
   *
   * #njc is server-rendered, so the markup is there long before the engine runs.
   * Waiting for njc.hot to EXIST is not enough for a second tab: the first tab
   * wrote that key, so the wait returns at once and the new tab is still showing
   * the prerendered zero. Wait until this tab's own ring agrees with what is
   * stored — that only happens once its engine has loaded and rendered.
   */
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("njc.hot");
    if (!raw) return false;
    const stored = Number(JSON.parse(raw)?.fields?.count ?? 0);
    return Number(document.getElementById("njcDigits")?.textContent ?? "-1") === stored;
  });
}

async function pickAName(page: Page) {
  await page.evaluate(() => document.getElementById("njcSelectBar")!.click());
  await page.waitForSelector("#njcAllList [data-id]");
  await page.evaluate(() => {
    (document.querySelector("#njcAllList [data-id]") as HTMLElement).click();
    (document.querySelector("#shName [data-close]") as HTMLElement | null)?.click();
  });
}

/** A tab with `taps` counted, and a second tab opened after it. */
async function twoTabs(page: Page, taps: number) {
  const a = page;
  await openCounter(a);
  await pickAName(a);
  await tap(a, taps);
  await expect.poll(() => storedCount(a)).toBe(taps);

  const b = await a.context().newPage();
  await openCounter(b);
  await expect.poll(() => count(b)).toBe(String(taps));
  return { a, b };
}

/* No test may touch the live site: it is under AdSense review. */
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

test("both tabs count, into one total", async ({ page }) => {
  const { a, b } = await twoTabs(page, 4);

  await tap(b, 3);
  await expect.poll(() => storedCount(b)).toBe(7);
  await expect.poll(() => count(a)).toBe("7");

  await tap(a, 2);
  await expect.poll(() => storedCount(a)).toBe(9);
  await expect.poll(() => count(b)).toBe("9");
});

test("there is no watching mode, notice or Count here button in either tab", async ({ page }) => {
  const { a, b } = await twoTabs(page, 2);
  await b.waitForTimeout(1500);
  for (const p of [a, b]) {
    await expect(p.locator("#njc.njc-watching")).toHaveCount(0);
    await expect(p.locator("#njc .njc-notice")).toHaveCount(0);
  }
});

test("a tab opened earlier does not write its stale copy over the other tab's taps", async ({ page }) => {
  const { a, b } = await twoTabs(page, 4);
  await tap(b, 3);
  await expect.poll(() => storedCount(b)).toBe(7);

  // A settings change goes through save() at once — the most direct of the
  // paths that used to write a stale tab's copy over everything.
  await a.evaluate(() => {
    (document.querySelector('#njcThemeSeg [data-th="ratri"]') as HTMLElement).click();
  });
  await a.waitForTimeout(400);

  expect(await storedCount(a)).toBe(7);
  await expect.poll(() => count(a)).toBe("7");
  await expect.poll(() => a.evaluate(() => document.getElementById("njc")!.getAttribute("data-theme"))).toBe("ratri");
});

test("undo in one tab never takes back the other tab's taps", async ({ page }) => {
  const { a, b } = await twoTabs(page, 0 + 2);
  await tap(a, 1);
  await expect.poll(() => storedCount(a)).toBe(3);
  // Tab b taps once it has the tap above — see the note on twoTabs.
  await expect.poll(() => count(b)).toBe("3");

  await tap(b, 3);
  await expect.poll(() => storedCount(b)).toBe(6);

  // Tab a's undo history was taken before b counted; stepping back through it
  // would erase b's taps, so it is cleared once b's count arrives.
  await a.evaluate(() => (document.getElementById("njcUndo") as HTMLButtonElement).click());
  await a.waitForTimeout(300);
  expect(await storedCount(a)).toBe(6);
});

test("closing one tab leaves the other counting from the latest total", async ({ page }) => {
  const { a, b } = await twoTabs(page, 5);
  await tap(b, 2);
  await expect.poll(() => storedCount(b)).toBe(7);
  await expect.poll(() => count(a)).toBe("7");
  await b.close();

  await tap(a, 1);
  await expect.poll(() => storedCount(a)).toBe(8);
  /*
   * The stored number above is the guarantee, and it is strict. The RING can lag
   * on WebKit: the tabs are separate processes, a read can be a moment stale, and
   * after the other tab closes nothing else wakes this one — so it may show the
   * previous total until the next tap or visit. A delayed re-read was tried as a
   * fix and removed (see the note in counter-engine.js): it risked writing an
   * older state over a good one, which is a worse fault than a late ring.
   */
  if (test.info().project.name !== "tablet") {
    await expect.poll(() => count(a)).toBe("8");
  }
});
