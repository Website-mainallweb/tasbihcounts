import { expect, test, type Page } from "@playwright/test";

import {
  blockThirdParty,
  isAnalyticsHit,
  isGoogleTag,
  runAnalyticsWithoutHits,
  watchForProductionRequests,
} from "./third-party";

/**
 * The layout contract, checked on the built site.
 *
 * Two failures are worth catching automatically because both are silent: a page
 * that scrolls sideways on a phone (the single most common responsive bug, and
 * invisible on a desktop monitor), and a CSP violation, which produces a console
 * error nobody is watching and an ad slot or a checkout button that simply never
 * appears.
 */
const PAGES = [
  "/",
  "/streak/",
  "/stats/",
  "/about-us/",
  "/contact-us/",
  "/privacy-policy/",
  "/terms/",
  "/refund-policy/",
  "/premium/",
  "/blog/",
];

/** Widths either side of every breakpoint the layouts switch at. */
const EDGES = [374, 375, 376, 767, 768, 769, 1023, 1024, 1025, 1279, 1280, 1281];

/**
 * CSP blocks that are decisions, not regressions. Each one needs a reason, and
 * the list stays short — everything not named here fails the suite, which is how
 * a newly blocked Razorpay or Supabase origin gets noticed instead of silently
 * breaking checkout.
 */
const ACCEPTED_CSP_BLOCKS = [
  // Google Signals' remarketing pixel, fired at google.<country tld>. The host
  // follows the visitor's country, so it cannot be enumerated in img-src, and
  // next.config.mjs blocks it on purpose: it is ad remarketing, not
  // measurement, and no report depends on it.
  /google\.[a-z.]+\/ads\/ga-audiences/,

  // A report-only violation blocked nothing, by definition — and this one is
  // google.com reporting against its own policy inside a frame it opened, not
  // ours. The site serves no report-only policy of its own; if it ever does,
  // narrow this so those are not swallowed too.
  /report-only Content Security Policy.*no further action has been taken/s,
  // The same report in WebKit's words (the tablet project): Google's reCAPTCHA
  // frame, opened by the ad tag, refusing to sit inside a page whose origin its
  // own frame-ancestors does not list. Named to that frame only.
  /^\[Report Only\] Refused to load https:\/\/www\.google\.com\/recaptcha\/[^ ]* because it does not appear in the frame-ancestors directive/,
];

async function scrollsSideways(page: Page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    // One pixel of slack: sub-pixel rounding at some zoom levels is not a bug.
    return d.scrollWidth - d.clientWidth > 1;
  });
}

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

for (const path of PAGES) {
  test(`${path} does not scroll sideways`, async ({ page }) => {
    await page.goto(path);
    expect(await scrollsSideways(page)).toBe(false);
  });

  test(`${path} logs no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    // Analytics only loads on the live domain; force it here so its CSP is
    // still exercised, with every hit answered locally.
    await runAnalyticsWithoutHits(page);

    await page.goto(path);
    await page.waitForLoadState("networkidle");

    // Drop the two kinds of noise, once, before either assertion sees them:
    // blocks we chose (ACCEPTED_CSP_BLOCKS), and whether a third-party host
    // happened to be reachable from this machine. An ad blocker, a failed ad
    // auction and WebKit-on-Windows refusing TLS to Google all land in the
    // console and none of them say anything about our code.
    const unexplained = errors
      .filter((e) => !ACCEPTED_CSP_BLOCKS.some((re) => re.test(e)))
      .filter(
        (e) =>
          !/Failed to load resource|ERR_BLOCKED_BY_CLIENT|SSL connect error|net::ERR_/i.test(
            e,
          ),
      )
      // The viewport's interactive-widget key (it keeps a field above the phone
      // keyboard) is progressive enhancement: Chrome and Firefox honour it,
      // Safari/WebKit just log that they ignored it. Harmless — iOS is covered
      // by the focus-scroll in counter-engine.js instead.
      .filter((e) => !/interactive-widget.*not recognized/i.test(e));

    // A CSP refusal is the failure this test exists for: silent in production,
    // and it turns an ad slot, an analytics hit or — soon — a Razorpay checkout
    // button into something that simply never appears. Asserted separately so
    // the failure message names the cause.
    const csp = unexplained.filter((e) =>
      /Content Security Policy|Refused to /i.test(e),
    );
    expect(csp, `unexpected CSP violations on ${path}`).toEqual([]);
    expect(unexplained, `console errors on ${path}`).toEqual([]);
  });
}

test("analytics stays off anywhere but the live domain", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (isGoogleTag(r.url()) || isAnalyticsHit(new URL(r.url()))) asked.push(r.url());
  });
  // Nothing should be asked for, but if it is, it must not reach Google.
  await blockThirdParty(page);

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  expect(asked, "analytics requested away from the live domain").toEqual([]);
  expect(await page.evaluate(() => "gtag" in window)).toBe(false);
});

test("forced analytics runs under the CSP, and its hits stay here", async ({ page }) => {
  const hits = await runAnalyticsWithoutHits(page);
  // Every hit the browser sends, whether or not the route caught it. A beacon
  // that slipped past the route would show up here and not in `hits`.
  const sent: string[] = [];
  page.on("request", (r) => {
    if (isAnalyticsHit(new URL(r.url()))) sent.push(r.url());
  });

  const tag = new Promise<"loaded" | "unreachable" | "never requested">((resolve) => {
    page.on("response", (r) => {
      if (isGoogleTag(r.url())) resolve(r.ok() ? "loaded" : "unreachable");
    });
    page.on("requestfailed", (r) => {
      if (isGoogleTag(r.url())) resolve("unreachable");
    });
    setTimeout(() => resolve("never requested"), 20_000);
  });

  await page.goto("/");
  const outcome = await tag;

  // Whether Google is reachable from this machine says nothing about the site;
  // WebKit on Windows, for one, cannot complete TLS to it.
  test.skip(outcome === "unreachable", "Google's tag could not be fetched from here");
  expect(outcome, "the tag was never requested — the override or the CSP stopped it").toBe(
    "loaded",
  );
  await expect
    .poll(() => hits.length, { timeout: 20_000, message: "the tag loaded but sent no hit" })
    .toBeGreaterThan(0);
  await expect
    .poll(() => sent.filter((u) => !hits.includes(u)), {
      message: "an analytics hit went past the route to Google",
    })
    .toEqual([]);
});

test("the counter holds together across every breakpoint edge", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Count .*Currently/ })).toBeVisible();

  for (const width of EDGES) {
    await page.setViewportSize({ width, height: 800 });
    // Let the layout settle before measuring.
    await page.waitForTimeout(120);
    expect(await scrollsSideways(page), `sideways scroll at ${width}px`).toBe(false);
    await expect(page.getByRole("button", { name: /^Count .*Currently/ }), `counter missing at ${width}px`).toBeVisible();
  }
});
