import { expect, test } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * The three legal pages Razorpay reviews before issuing live keys, and the
 * AdSense review reads.
 *
 * The privacy policy used to promise "no advertising trackers, no third-party
 * cookies" on a site that runs AdSense and Google Analytics. The last test is
 * that: the disclosures Google requires must be on the page.
 */

const LEGAL = [
  ["/privacy-policy/", "Privacy Policy"],
  ["/terms/", "Terms of Service"],
  ["/refund-policy/", "Refund & Cancellation Policy"],
] as const;

test.beforeEach(async ({ page }) => {
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

for (const [path, heading] of LEGAL) {
  test(`${path} renders whole, with a working contact address`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("main h1")).toHaveText(heading);
    await expect(page).toHaveTitle(`${heading} - Bhakti Nam Jap`);

    // The placeholder was filled in everywhere.
    expect(await page.locator("main").innerHTML()).not.toContain("{{");

    // One address, contact@ the site's own domain — the canonical link's host.
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    const host = new URL(canonical!).hostname.replace(/^www\./, "");
    const mailtos = await page
      .locator('main a[href^="mailto:"]')
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(mailtos.length).toBeGreaterThan(0);
    for (const href of mailtos) expect(href).toBe(`mailto:contact@${host}`);

    // Legal pages carry no ads.
    await expect(page.locator("main .ad")).toHaveCount(0);
  });
}

test("the footer links to all three", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator(".site-footer");
  for (const [path] of LEGAL) {
    await expect(footer.locator(`a[href="${path}"]`)).toHaveCount(1);
  }
});

test("the sitemap lists the new pages", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain("/terms/</loc>");
  expect(xml).toContain("/refund-policy/</loc>");
});

test("refund and terms point at each other", async ({ page }) => {
  await page.goto("/refund-policy/");
  await expect(page.locator('main a[href="/terms/"]')).toHaveCount(1);
  await page.goto("/terms/");
  await expect(page.locator('main a[href="/refund-policy/"]')).toHaveCount(1);
});

test("the plan is stated the same way on both commercial pages", async ({ page }) => {
  for (const path of ["/terms/", "/refund-policy/"]) {
    await page.goto(path);
    const text = await page.locator("main").innerText();
    expect(text).toContain("₹200");
    expect(text).toMatch(/one-time/i);
    expect(text).toMatch(/lifetime/i);
    expect(text).toMatch(/no free trial|there is no free trial/i);
  }
});

test("the privacy policy discloses ads and analytics", async ({ page }) => {
  await page.goto("/privacy-policy/");
  const main = page.locator("main");
  const text = await main.innerText();

  expect(text).not.toMatch(/no advertising trackers/i);
  expect(text).toContain("Google AdSense");
  expect(text).toContain("Google Analytics");
  expect(text).toMatch(/third-party vendors, including Google, use cookies/i);
  await expect(main.locator('a[href="https://adssettings.google.com/"]')).toHaveCount(1);
  await expect(
    main.locator('a[href="https://policies.google.com/technologies/partner-sites"]'),
  ).toHaveCount(1);
  expect(text).toContain("Digital Personal Data Protection Act, 2023");
});
