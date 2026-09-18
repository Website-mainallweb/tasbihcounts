import "server-only";

import { headers } from "next/headers";

import { SITE_URL } from "@/lib/site";

/**
 * Where a link we send somebody should point.
 *
 * Not `SITE_URL`. That constant is the site's canonical address — right for a
 * `<link rel="canonical">`, for the sitemap and for Open Graph, all of which must
 * name the real site whatever machine built them. It is the wrong answer for a
 * link in an email, because it falls back to the production domain when
 * `NEXT_PUBLIC_SITE_URL` is unset: a password-reset sent while testing locally
 * would arrive pointing at the live site, and the token would be spent there.
 *
 * So this reads the request instead. A deployment answers on its own domain and
 * the link says that domain; a local run answers on localhost and the link says
 * localhost. Nothing to configure and nothing to remember when the domain
 * changes.
 *
 * The site's checkout routes already do this with `signInLinkOrigin(request)`.
 * This is the same idea for a server action or a page, which are handed no
 * Request object and have to ask for the headers.
 */

/**
 * Hosts we will build a link for. Anything else falls back to SITE_URL.
 *
 * `admin.localhost` has to be in here, not only bare `localhost`. Without it a
 * reset sent while testing the panel locally fell back to the production domain
 * — which is the exact bug this module exists to prevent, reappearing one
 * subdomain to the left.
 */
function trusted(hostname: string): boolean {
  if (hostname === "127.0.0.1" || hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }
  const canonical = new URL(SITE_URL).hostname.replace(/^www\./, "");
  // The site, www, and any subdomain of it — the admin panel included.
  return hostname === canonical || hostname.endsWith(`.${canonical}`);
}

/**
 * The origin this request arrived on, with any `admin.` label removed.
 *
 * The label matters. A password-reset link is for a buyer, and a buyer signs in
 * on the site — sending them to admin.<domain>/auth/reset/ would work by
 * accident today (the proxy passes /auth through) and break the moment the panel
 * is locked to an IP. The link should name the place the person is going.
 *
 * Falls back to SITE_URL when the host header is missing or is not ours, which
 * is what a preview deployment or a stray Host header gets. That is the safe way
 * round: a canonical link that is not quite local beats a link pointing at
 * whatever host an attacker put in the header.
 */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return SITE_URL;

  // x-forwarded-proto is what a TLS-terminating proxy sets; without one, the
  // only thing serving plain http is a local run.
  const bare = host.split(":")[0];
  const local = bare === "127.0.0.1" || bare === "localhost" || bare.endsWith(".localhost");
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (local ? "http" : "https");

  let url: URL;
  try {
    url = new URL(`${proto}://${host}`);
  } catch {
    return SITE_URL;
  }

  if (!trusted(url.hostname)) return SITE_URL;

  if (url.hostname.startsWith("admin.")) {
    url.hostname = url.hostname.slice("admin.".length);
  }
  return url.origin;
}
