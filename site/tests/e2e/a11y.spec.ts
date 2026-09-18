import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * Accessibility, checked by axe on the pages people actually use (ARCHITECTURE §6,
 * Phase 12). Serious and critical violations fail; each failure names the rule,
 * the element and axe's own fix hint, so it can be acted on without re-running.
 *
 * Run on a phone and a desktop: the counter's layouts differ enough that a
 * control reachable on one can be hidden, unlabelled or too small on the other.
 */

const PAGES = [
  "/",
  "/streak/",
  "/stats/",
  "/premium/",
  "/login/",
  "/about-us/",
  "/contact-us/",
  "/privacy-policy/",
  "/terms/",
  "/refund-policy/",
];

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name === "tablet", "phone and desktop cover the two extremes");
  await blockThirdParty(page);
});

/* No test may touch the live site: it is under AdSense review. */
let assertNoProductionTraffic: (() => void) | undefined;

test.beforeEach(({ page }) => {
  assertNoProductionTraffic = watchForProductionRequests(page);
});

test.afterEach(() => {
  assertNoProductionTraffic?.();
  assertNoProductionTraffic = undefined;
});

for (const path of PAGES) {
  test(`${path} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    // The counter builds its markup after hydration; audit what a person sees.
    await page.waitForLoadState("load");
    if (path === "/") await page.waitForFunction(() => !!localStorage.getItem("njc.hot"));

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      // Ad slots are Google's markup inside Google's frames, not ours to fix, and
      // they are blocked in this suite anyway.
      .exclude(".ad")
      .analyze();

    const serious = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        rule: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`),
      }));

    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}
