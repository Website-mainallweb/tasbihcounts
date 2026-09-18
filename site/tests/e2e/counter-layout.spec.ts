import { expect, test, type Page } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * The counter has to be usable on a tablet and a desktop the way it already is
 * on a phone: everything someone needs mid-mala on screen at once, without
 * scrolling, in the page and in full screen.
 *
 * Every assertion here is a bug that shipped:
 *
 *   - on a 768px tablet the ring was 201px, smaller than on a phone, because the
 *     counter sat beside a 286px panel and the sidebar took the rest
 *   - between 1024 and 1279 the library rail appeared in a layout with no column
 *     for it, and the counter's controls fell off a landscape tablet
 *   - the mode chips were centred with justify-content, which on a row that
 *     overflows pushes the first chips off the left edge for good
 *   - at 1280x800 the mode chips sat under the fold
 *   - in full screen on a 1024x768 tablet the control rail was cut off, Exit
 *     included, leaving only the Escape key as a way out
 *   - in full screen on a large screen the control labels were cut to "E..."
 *
 * The phone project is skipped: this is about the layouts above the phone, and
 * forcing a 1920px viewport into an emulated handset measures the emulation.
 */

type Layout = {
  ring: number;
  immersive: boolean;
  controlsFit: boolean;
  modesFit: boolean;
  chipStartVisible: boolean;
  cutLabels: number;
  leftRail: boolean;
  sideways: number;
};

const layout = (page: Page): Promise<Layout> =>
  page.evaluate(() => {
    const R = document.getElementById("njc")!;
    const q = (s: string) => R.querySelector(s) as HTMLElement;
    const rail = q(".njc-ctlrail");
    const modes = q(".njc-modes");
    const first = modes.firstElementChild as HTMLElement | null;
    const labels = [...R.querySelectorAll<HTMLElement>(".njc-ctl .lg")].filter(
      (e) => getComputedStyle(e).display !== "none",
    );
    return {
      ring: Math.round(q("#njcStage").getBoundingClientRect().width),
      immersive: R.classList.contains("immersive"),
      controlsFit: Math.round(rail.getBoundingClientRect().bottom) <= innerHeight,
      modesFit: Math.round(modes.getBoundingClientRect().bottom) <= innerHeight,
      chipStartVisible: first
        ? first.getBoundingClientRect().left >= modes.getBoundingClientRect().left - 1
        : true,
      cutLabels: labels.filter((e) => e.scrollWidth > e.clientWidth + 1).length,
      leftRail: getComputedStyle(q(".njc-rail.left")).display !== "none",
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

async function openCounter(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // #njc is server-rendered; wait for the engine itself.
  await page.waitForFunction(() => !!localStorage.getItem("njc.hot"));
  await page.evaluate(() => document.getElementById("njcSelectBar")!.click());
  await page.waitForSelector("#njcAllList [data-id]");
  await page.evaluate(() => {
    (document.querySelector("#njcAllList [data-id]") as HTMLElement).click();
    (document.querySelector("#shName [data-close]") as HTMLElement | null)?.click();
  });
}

/** Everything a chanter reaches for, on screen and whole. */
const usable = {
  controlsFit: true,
  modesFit: true,
  chipStartVisible: true,
  cutLabels: 0,
  sideways: 0,
};

const SIZES = [
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "large tablet portrait", width: 820, height: 1180 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "large tablet landscape", width: 1180, height: 820 },
  { name: "small desktop", width: 1280, height: 800 },
  { name: "large desktop", width: 1920, height: 1080 },
] as const;

test.beforeEach(({}, info) => {
  test.skip(info.project.name === "mobile", "layouts above the phone only");
});

test.beforeEach(async ({ page, context }) => {
  await blockThirdParty(page);
  context.on("page", (p) => {
    void blockThirdParty(p);
  });
});

/* No test may touch the live site: it is under AdSense review.
   A skipped test never reaches the hook that sets the guard, but afterEach
   still runs — so call it only if this test set it, and clear it after, or a
   skipped test calls undefined (or a stale guard left by an earlier test). */
let assertNoProductionTraffic: (() => void) | undefined;

test.beforeEach(({ page }) => {
  assertNoProductionTraffic = watchForProductionRequests(page);
});

test.afterEach(() => {
  assertNoProductionTraffic?.();
  assertNoProductionTraffic = undefined;
});

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}x${size.height}`, () => {
    test("everything needed mid-mala is on screen in the page", async ({ page }) => {
      await openCounter(page, size.width, size.height);
      // Polled: the ring is sized a tick after layout settles.
      await expect.poll(() => layout(page)).toMatchObject(usable);

      const l = await layout(page);
      // The library rail belongs to the three-column desktop layout only.
      expect(l.leftRail).toBe(size.width >= 1280);
    });

    test("and in full screen, with Exit reachable", async ({ page }) => {
      await openCounter(page, size.width, size.height);
      await page.evaluate(() => document.getElementById("njcFs")!.click());

      await expect.poll(async () => (await layout(page)).immersive).toBe(true);
      await expect.poll(() => layout(page)).toMatchObject(usable);
    });
  });
}

test("a tablet ring is at least as large as a phone's", async ({ page }) => {
  // The phone ring is 337px at 390x844. A 768px tablet used to get 201.
  await openCounter(page, 768, 1024);
  await expect.poll(async () => (await layout(page)).ring).toBeGreaterThanOrEqual(400);
});
