import { SITE_URL } from "@/lib/site";

/**
 * Two small decisions the checkout routes share.
 *
 * The checkout endpoints take no user (the account does not exist until the
 * payment does), so a same-site Origin is the depth defence against another page
 * posting to them. It is not what makes them safe — nothing they do grants
 * anything without Razorpay's own record of a payment — but it keeps them from
 * being a free order-creation API for the rest of the web.
 */

const siteOrigin = new URL(SITE_URL).origin;
const siteHost = new URL(SITE_URL).hostname;

function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/** The request came from a page on this site (or a local build of it). */
export function isSameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.origin === siteOrigin || url.hostname === `www.${siteHost}` || isLocal(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Where the "your Premium is ready" sign-in link should point. The browser's own
 * Origin when it is a page of this site, so a local test gets a local link and
 * never sends anyone to the live site; the canonical site otherwise — which is
 * what a webhook, having no browser, always gets.
 */
export function signInLinkOrigin(request?: Request): string {
  if (request && isSameSite(request)) return new URL(request.headers.get("origin")!).origin;
  return siteOrigin;
}
