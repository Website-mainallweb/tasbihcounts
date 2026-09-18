import { expect, test, type Page } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * Where things sit, not just whether they fit.
 *
 * Every test here is a placement mistake found by walking the site at thirteen
 * sizes (2026-09-10), plus the frame of the 2026-09-13 redesign:
 *
 *   - the header and footer stopped at 1120px while the counter ran edge to
 *     edge, so the logo sat 75px inside the Library rail at 1366 and 350px
 *     inside it at 1920
 *   - uneven rails put the ring 16px left of the page title at 1366
 *   - "Haptic" was cut in half at the right edge of every phone
 *   - long names ended in "…" in the library list
 *   - on a phone on its side the controls were under the fold
 *   - on a 1024x768 tablet the ring was 233px, smaller than on a phone
 *   - the notice's close button fell onto a line of its own under the text
 *
 * Sizes are forced inside each test, so the phone project is skipped: forcing
 * a 1920px window into an emulated handset measures the emulation.
 */

test.beforeEach(({}, info) => {
  test.skip(info.project.name === "mobile", "sizes are set per test");
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

/** Left and right of the header's content box, inside its padding. */
const headerContent = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".site-header .wrap") as HTMLElement;
    const r = el.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(el).paddingLeft);
    return { left: r.left + pad, right: r.right - pad, centre: (r.left + r.right) / 2 };
  });

test.describe("the header row: logo and links at the start, actions at the end", () => {
  /* Redesign 2026-09-13: the links sit beside the logo, as on most sites, and
     Log in / Get Premium close the row on the right. Below 1024 the links are in
     the drawer. */
  for (const [width, height] of [
    [1024, 768],
    [1366, 768],
    [1920, 1080],
  ] as const) {
    for (const path of ["/", "/about-us/"]) {
      test(`${path} at ${width}x${height}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto(path);
        const bar = await headerContent(page);
        const m = await page.evaluate(() => {
          const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
          return { brand: r(".site-header .brand"), nav: r(".site-nav"), end: r(".header-end") };
        });
        expect(Math.abs(m.brand.left - bar.left)).toBeLessThanOrEqual(2);
        expect(m.nav.left - m.brand.right).toBeGreaterThanOrEqual(8);
        expect(m.nav.left - m.brand.right).toBeLessThanOrEqual(40);
        expect(Math.abs(m.end.right - bar.right)).toBeLessThanOrEqual(2);
        expect(m.nav.right).toBeLessThan(m.end.left);
      });
    }
  }
});

test.describe("reading pages fill the frame edge to edge", () => {
  for (const [width, height] of [
    [375, 812],
    [768, 1024],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    test(`/about-us/ at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/about-us/");
      const bar = await headerContent(page);
      const m = await page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        return { main: r(".page-main"), aside: r(".page-aside") };
      });
      expect(Math.abs(m.main.left - bar.left)).toBeLessThanOrEqual(2);
      const right = width >= 1024 ? m.aside.right : m.main.right;
      expect(Math.abs(right - bar.right)).toBeLessThanOrEqual(2);
    });
  }
});
test.describe("header, counter and footer share one frame", () => {
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ] as const) {
    test(`edges line up at ${width}x${height}`, async ({ page }) => {
      await openCounter(page, width, height);
      const bar = await headerContent(page);
      const grid = await page.locator(".njc-grid").boundingBox();
      const footer = await page.evaluate(() => {
        const el = document.querySelector(".site-footer .wrap") as HTMLElement;
        return el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
      });

      expect(Math.abs(grid!.x - bar.left)).toBeLessThanOrEqual(2);
      expect(Math.abs(grid!.x + grid!.width - bar.right)).toBeLessThanOrEqual(2);
      expect(Math.abs(footer - bar.left)).toBeLessThanOrEqual(2);
    });
  }

  for (const [width, height] of [
    [768, 1024],
    [1280, 800],
    [1366, 768],
    [1920, 1080],
  ] as const) {
    test(`the ring is on the page's centre line at ${width}x${height}`, async ({ page }) => {
      await openCounter(page, width, height);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const r = document.getElementById("njcStage")!.getBoundingClientRect();
            return Math.abs((r.left + r.right) / 2 - document.documentElement.clientWidth / 2);
          }),
        )
        .toBeLessThanOrEqual(3);
    });
  }
});

test.describe("phones", () => {
  for (const width of [360, 390]) {
    test(`all five modes fit one row at ${width}px`, async ({ page }) => {
      await openCounter(page, width, 800);
      const modes = page.locator("#njc .njc-modes");
      await expect(modes.locator("> *")).toHaveCount(5);
      await expect
        .poll(() => modes.evaluate((m) => m.scrollWidth - m.clientWidth))
        .toBeLessThanOrEqual(1);
    });
  }

  test("a long name in the library is shown whole", async ({ page }) => {
    await openCounter(page, 375, 812);
    const cut = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>(".njc-libitem .n b")].filter(
          (b) => b.offsetParent && b.scrollWidth > b.clientWidth + 1,
        ).length,
    );
    expect(cut).toBe(0);
  });

  test("the notice's close button stays on the message's row", async ({ page }) => {
    // The backup reminder is a notice with an action button. It appears for a
    // practice worth keeping that has never been backed up, so seed one — from a
    // page the engine is not running on, or its own save would overwrite it.
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/terms/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "njc.cold",
        JSON.stringify({ v: 2, state: { v: 1, nameId: "ram", lifetime: 1500, lastBackup: null, nudgedOn: null } }),
      );
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const notice = page.locator("#njc .njc-notice");
    await expect(notice.locator(".act")).toBeVisible();

    const [p, x, act] = await Promise.all([
      notice.locator("p").boundingBox(),
      notice.locator(".x").boundingBox(),
      notice.locator(".act").boundingBox(),
    ]);
    // Beside the text, and above the action button.
    expect(x!.x).toBeGreaterThan(p!.x + p!.width - 1);
    expect(x!.y).toBeLessThan(p!.y + p!.height);
    expect(act!.y).toBeGreaterThanOrEqual(p!.y + p!.height - 1);
  });
});

/** Ring size, and whether the controls and modes are whole and on screen. */
const onScreen = (page: Page) =>
  page.evaluate(() => {
    const R = document.getElementById("njc")!;
    const q = (s: string) => R.querySelector(s) as HTMLElement;
    const modes = q(".njc-modes");
    return {
      split: getComputedStyle(q(".njc-col")).display === "grid",
      ring: Math.round(q("#njcStage").getBoundingClientRect().width),
      controls: Math.round(q(".njc-ctlrail").getBoundingClientRect().bottom) <= innerHeight,
      modes: Math.round(modes.getBoundingClientRect().bottom) <= innerHeight,
      modesWhole: modes.scrollWidth <= modes.clientWidth + 1,
    };
  });

test.describe("a phone on its side", () => {
  for (const [width, height] of [
    [667, 375],
    [844, 390],
    [932, 430],
  ] as const) {
    test(`${width}x${height}: ring beside its controls, all on screen`, async ({ page }) => {
      await openCounter(page, width, height);
      await expect
        .poll(() => onScreen(page))
        .toMatchObject({ split: true, controls: true, modes: true, modesWhole: true });
      expect((await onScreen(page)).ring).toBeGreaterThanOrEqual(150);
    });

    test(`${width}x${height}: the same in full screen`, async ({ page }) => {
      await openCounter(page, width, height);
      await page.evaluate(() => document.getElementById("njcFs")!.click());
      // Full screen arrives a tick later. Since the redesign the modes also fit in
      // the page itself, so without this the poll below matched the page layout
      // before full screen had begun.
      await expect
        .poll(() => page.evaluate(() => document.getElementById("njc")!.classList.contains("immersive")))
        .toBe(true);
      await expect
        .poll(() => onScreen(page))
        .toMatchObject({ split: true, controls: true, modes: true, modesWhole: true });
      // The ring is re-measured a tick after full screen lays out: read it with a retry.
      await expect.poll(async () => (await onScreen(page)).ring).toBeGreaterThanOrEqual(180);
    });
  }
});

test("a landscape tablet ring is no smaller than a phone's", async ({ page }) => {
  // 233px before; a 375px phone gets 308.
  await openCounter(page, 1024, 768);
  await expect.poll(async () => (await onScreen(page)).ring).toBeGreaterThanOrEqual(290);
  expect(await onScreen(page)).toMatchObject({ split: false, controls: true, modes: true });
});
