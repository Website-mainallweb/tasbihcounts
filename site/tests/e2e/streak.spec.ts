import { expect, test, type Page } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * The streak page reads what the counter saved and writes nothing.
 *
 * History is seeded before the app runs, through addInitScript. Seeding after
 * load and reloading does not work: the outgoing page's pagehide handler writes
 * its own state back on the way out, and the fresh load finds that instead.
 */

/** Local date keys, so the seed lines up with what the engine would write. */
function dayKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`;
}

const done = { c: 108, r: 1, s: 300_000 };
const tappedOnly = { c: 30, r: 0, s: 60_000 };

async function seed(
  page: Page,
  hist: Record<string, unknown>,
  lifetime = 500,
  settings: Record<string, unknown> = {},
) {
  await page.addInitScript(
    ([h, life, more]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.clear();
      localStorage.setItem(
        "njc.v1",
        JSON.stringify({
          lifetime: life,
          malaDone: 4,
          nameId: "ram",
          target: 108,
          hist: h,
          ...(more as Record<string, unknown>),
        }),
      );
    },
    [hist, lifetime, settings] as const,
  );
}

const card = (page: Page, name: string) =>
  page.locator(".streak .card").filter({ hasText: name });

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

test("shows the current run, the record, and the days behind them", async ({ page }) => {
  await seed(page, {
    [dayKey(-2)]: done,
    [dayKey(-1)]: done,
    [dayKey(0)]: done,
    // An old run of four, longer than the current one.
    "2026-01-01": done,
    "2026-01-02": done,
    "2026-01-03": done,
    "2026-01-04": done,
  });
  await page.goto("/streak/");

  await expect(card(page, "Current")).toContainText("3");
  await expect(card(page, "Best")).toContainText("4");
  await expect(card(page, "Days target reached")).toContainText("7");
});

test("keeps a run alive while today is still open", async ({ page }) => {
  // Nobody's streak should break at midnight when there is still time to chant.
  await seed(page, { [dayKey(-2)]: done, [dayKey(-1)]: done });
  await page.goto("/streak/");

  await expect(card(page, "Current")).toContainText("2");
  await expect(page.locator(".streak .at-risk")).toBeVisible();
  await expect(page.locator(".streak .at-risk")).toContainText("Today is still open");
});

test("a day that was tapped but never completed does not count", async ({ page }) => {
  await seed(page, { [dayKey(-1)]: tappedOnly, [dayKey(0)]: tappedOnly });
  await page.goto("/streak/");

  await expect(card(page, "Current")).toContainText("0");
  await expect(card(page, "Days target reached")).toContainText("0");
});

test("says so plainly when there is nothing yet", async ({ page }) => {
  await seed(page, {}, 0);
  await page.goto("/streak/");
  await expect(page.locator(".streak .lead")).toContainText("Nothing recorded yet");
});

test("marks today in the week strip and the calendar", async ({ page }) => {
  await seed(page, { [dayKey(0)]: done });
  await page.goto("/streak/");

  await expect(page.locator('.streak .week li[data-today]')).toHaveCount(1);
  await expect(page.locator('.streak .week li[data-today]')).toHaveAttribute(
    "data-state",
    "done",
  );
  await expect(page.locator(".streak .cal-day[data-today]")).toHaveCount(1);
});

test("the calendar walks back but not into the future", async ({ page }) => {
  await seed(page, { [dayKey(-40)]: done, [dayKey(0)]: done });
  await page.goto("/streak/");

  const heading = page.locator(".streak .cal-head h2");
  const thisMonth = await heading.textContent();

  await expect(page.locator('button[aria-label="Next month"]')).toBeDisabled();

  await page.locator('button[aria-label="Previous month"]').click();
  await expect(heading).not.toHaveText(thisMonth!);
  await expect(page.locator('button[aria-label="Next month"]')).toBeEnabled();
});

test("the header chip appears only once there is a run", async ({ page }) => {
  await seed(page, {});
  await page.goto("/");
  await expect(page.locator(".streak-chip")).toHaveCount(0);
});

test("the header chip leads to the streak page", async ({ page }) => {
  await seed(page, { [dayKey(-1)]: done, [dayKey(0)]: done });
  await page.goto("/");

  const chip = page.locator(".streak-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("2");

  await chip.click();
  await page.waitForURL("**/streak/");
  await expect(page.locator(".streak h1")).toHaveText("Streak");
});

test("does not write to the counter's storage", async ({ page }) => {
  // A page that reads someone's practice must not be able to change it.
  await seed(page, { [dayKey(-40)]: done, [dayKey(0)]: done });
  await page.goto("/streak/");
  const before = await page.evaluate(() => localStorage.getItem("njc.v1"));

  await page.locator('button[aria-label="Previous month"]').click();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => ({
    legacy: localStorage.getItem("njc.v1"),
    hot: localStorage.getItem("njc.hot"),
    cold: localStorage.getItem("njc.cold"),
  }));
  expect(after.legacy).toBe(before);
  expect(after.hot).toBeNull();
  expect(after.cold).toBeNull();
});

test("speaks Hindi when the counter is set to Hindi", async ({ page }) => {
  // The ring and this page read the same practice; they must not disagree about
  // the language it is described in (#16/#29).
  await seed(page, { [dayKey(-1)]: done, [dayKey(0)]: done }, 500, {
    lang: "hi",
    numerals: "deva",
  });
  await page.goto("/streak/");

  await expect(page.locator(".streak h1")).toHaveText("निरंतरता");
  await expect(page.locator(".streak .card.now")).toContainText("२");
  await expect(page.locator('button[aria-label="पिछला महीना"]')).toBeVisible();
  await expect(page.locator(".streak .week .wd").first()).toHaveText("सोम");
  // And the document says which language it is in, for a screen reader.
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
});
