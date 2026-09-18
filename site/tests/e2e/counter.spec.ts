import { expect, test, type Page } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * Phase 2's behaviour, checked in a real browser on the production build.
 *
 * The unit tests cover the logic; these cover the wiring, which is where the two
 * genuine bugs of this phase lived — a `setInterval` invoked with the wrong
 * `this`, and an election that let both tabs believe they were the leader. Both
 * passed every unit test.
 */

const tap = async (page: Page, times = 1) => {
  await page.evaluate((n) => {
    const s = document.getElementById("njcSurface")!;
    for (let i = 0; i < n; i++) {
      s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 300 }));
      s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 200, clientY: 300 }));
    }
  }, times);
};

const hot = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("njc.hot") || "null"));

/**
 * Pick the first name, so the counter will accept taps.
 *
 * Driven through evaluate rather than Playwright clicks: the list items carry a
 * favourite-toggle span that swallows a click aimed at the row, and the sheet's
 * scrim covers the close button until the open animation finishes. Neither is
 * what these tests are about.
 */
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

/* These check our own behaviour, so the ad and analytics tags are cut off — see
   third-party.ts. responsive.spec.ts keeps the real network. */
test.beforeEach(async ({ page, context }) => {
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

test.describe("counter storage", () => {
  test("the engine actually runs, not just the server HTML", async ({ page }) => {
    /*
     * `#njc` being visible proves nothing: the markup is server-rendered, so it
     * is there even when every script has failed to load. That is exactly how
     * the WebKit project passed for a while against a page with no CSS and no
     * JavaScript. Assert on something only the engine can produce.
     */
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/");
    await expect(page.locator("#njc")).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => !!localStorage.getItem("njc.hot")))
      .toBe(true);

    // And that the stylesheet arrived — an unstyled button is inline-block.
    const display = await page.evaluate(
      () => getComputedStyle(document.getElementById("njcSurface")!).display,
    );
    expect(display).not.toBe("inline-block");

    expect(errors).toEqual([]);
  });

  test("splits state into a small hot blob and a cold one", async ({ page }) => {
    await page.goto("/");
    await pickAName(page);
    await tap(page, 3);

    const h = await hot(page);
    expect(h.v).toBe(2);
    expect(h.sourceId).toBeTruthy();
    expect(h.fields.count).toBe(3);
    expect(h.rec.c).toBe(3);

    // The whole point: what a tap rewrites does not grow with history.
    const size = await page.evaluate(() => localStorage.getItem("njc.hot")!.length);
    expect(size).toBeLessThan(600);
    expect(h.fields.hist).toBeUndefined();
  });

  test("marks the outbox under a day-and-name key", async ({ page }) => {
    await page.goto("/");
    await pickAName(page);
    await tap(page, 4);

    const h = await hot(page);
    const keys = Object.keys(h.outbox);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^\d{4}-\d{2}-\d{2}\|.+/);
    expect(h.outbox[keys[0]].c).toBe(4);
  });

  test("keeps the pre-split state as a backup and never deletes it", async ({ page }) => {
    /*
     * The old state has to be in place before the engine runs. Seeding it and
     * then reloading does not work: the outgoing page's pagehide handler writes
     * the split keys back on the way out, and the fresh load then finds them and
     * never looks at the legacy key at all.
     */
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.clear();
      localStorage.setItem(
        "njc.v1",
        JSON.stringify({
          lifetime: 500,
          malaDone: 4,
          nameId: "ram",
          hist: { "2026-01-01": { c: 108, r: 1, s: 60000 } },
        }),
      );
    });
    await page.goto("/");
    await expect(page.locator("#njc")).toBeVisible();

    /* #njc is server-rendered, so it is visible before the engine has run.
       Waiting for the backup key is waiting for the migration itself. */
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).sort()))
      .toContain("njc.legacy_v1");

    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(keys).toContain("njc.v1");
    expect(keys).toContain("njc.hot");

    // The migrated history survived, and lifetime came with it. Asserted with
    // toHaveText rather than a bare textContent read: the panel renders its
    // starting zero before the engine has loaded, so reading once races the
    // boot and fails only when the machine is busy.
    await expect(page.locator("#njcPTotal")).toHaveText("500");
  });
});

test.describe("undo", () => {
  test("takes the completed round back down with the count", async ({ page }) => {
    // rec.r decides the streak, so leaving it credited after an undo would hand
    // out a day the user did not practise.
    await page.goto("/");
    await pickAName(page);

    await page.evaluate(() => {
      document.getElementById("njcTargetBtn")!.click();
      const b = [...document.querySelectorAll("#njcTargets [data-t]")].find(
        (x) => x.getAttribute("data-t") === "11",
      ) as HTMLElement;
      b.click();
      (document.querySelector("#shTarget [data-close]") as HTMLElement).click();
    });

    await tap(page, 11);
    expect((await hot(page)).rec).toMatchObject({ c: 11, r: 1 });

    await page.locator("#njcUndo").click();
    expect((await hot(page)).rec).toMatchObject({ c: 10, r: 0 });
  });
});
