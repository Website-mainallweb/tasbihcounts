import type { Page } from "@playwright/test";

import { ANALYTICS_OVERRIDE, SITE_URL } from "../../src/lib/site";

/** Google's tag loader itself. Fetching it is not a hit. */
export function isGoogleTag(url: string): boolean {
  return url.startsWith("https://www.googletagmanager.com/gtag/js");
}

/**
 * A request that would record something in GA4. The tag posts to a regional
 * google-analytics subdomain, falls back to analytics.google.com, and a Google
 * tag (GT-) can also collect through google.com — see the CSP in
 * next.config.mjs, which names the same hosts.
 */
export function isAnalyticsHit(url: URL): boolean {
  const host = url.hostname;
  if (/(^|\.)google-analytics\.com$/.test(host)) return true;
  if (/(^|\.)analytics\.google\.com$/.test(host)) return true;
  return /(^|\.)(google\.com|googletagmanager\.com)$/.test(host) && url.pathname.includes("/collect");
}

/**
 * Refuse the requests that leave this site.
 *
 * Most of these tests are about our own behaviour — storage, navigation, the
 * counter's arithmetic — and none of that involves Google. But every page loads
 * the AdSense and analytics tags, `page.goto` waits for `load`, and `load` waits
 * for them. With several browser projects running at once those requests
 * regularly took longer than the timeout, and tests failed for reasons that had
 * nothing to do with the thing they were checking.
 *
 * The predicate matters. Routing everything and deciding inside the handler puts
 * every stylesheet, script and page of our own through the interception layer
 * too; across three projects at once that was enough to crash a browser session
 * outright. Matching on the URL means Playwright only intercepts what is
 * actually going to be blocked.
 *
 * `allow` names hosts that must still be reached, for a spec whose subject is a
 * call that leaves the site — the browser verifying a one-time code against
 * Supabase, for instance. Without it that call is aborted and the form reports a
 * failure that has nothing to do with the code.
 *
 * Blocking these is not hiding a problem: whether the real tags load, and
 * whether the CSP lets them, is checked in responsive.spec.ts, which keeps the
 * network and waits for it to settle.
 *
 * Not named `*.spec.ts`, so Playwright does not collect it as a suite.
 */
export async function blockThirdParty(page: Page, allow: string[] = []): Promise<void> {
  const allowed = (host: string) => allow.some((h) => host === h || host.endsWith(`.${h}`));
  await page
    .route(
      (url) =>
        url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && !allowed(url.hostname),
      (route) => route.abort().catch(() => {}),
    )
    // A page that closed before the route was installed is not a failure.
    .catch(() => {});
}

/**
 * Run the real analytics tag on this server, and answer its hits here.
 *
 * The layout only loads analytics on the live domain, so without this the CSP
 * for analytics would go untested. The tag itself is fetched from Google as
 * normal; every hit it then sends is fulfilled locally with a 204. A CSP refusal
 * happens in the browser before a request is ever routed, so answering the hit
 * here hides nothing the CSP check is looking for.
 *
 * Returns the hits as they arrive, so a test can prove the tag actually ran.
 */
export async function runAnalyticsWithoutHits(page: Page): Promise<string[]> {
  const hits: string[] = [];
  await page.addInitScript((flag) => {
    Object.assign(window, { [flag]: true });
  }, ANALYTICS_OVERRIDE);
  await page
    .route(isAnalyticsHit, (route) => {
      hits.push(route.request().url());
      return route.fulfill({ status: 204 }).catch(() => {});
    })
    .catch(() => {});
  return hits;
}

/**
 * Watch for anything asking for the production host.
 *
 * Nothing under `src/` performs a request at all — the site constant only ever
 * builds strings, for canonical tags, the sitemap, robots and a link in the
 * contact copy. This turns that into something the suite enforces rather than
 * something anyone has to keep checking, because the site is under AdSense
 * review and a stray hit from an automated run is exactly what must not happen.
 *
 * The host comes from the app's own constant, so changing the domain cannot
 * quietly leave this watching the wrong one.
 *
 * Returns the check to run once the test is over. Throwing from inside a page
 * event would only produce an unhandled rejection, which fails nothing.
 */
export function watchForProductionRequests(page: Page): () => void {
  const host = new URL(SITE_URL).hostname;
  const seen = new Set<string>();

  page.on("request", (req) => {
    try {
      if (new URL(req.url()).hostname === host) seen.add(req.url());
    } catch {
      /* not a URL worth reading */
    }
  });

  return () => {
    if (seen.size > 0) {
      const list = [...seen].join("\n  ");
      throw new Error(
        `A test requested the production site, which must never happen:\n  ${list}`,
      );
    }
  };
}
