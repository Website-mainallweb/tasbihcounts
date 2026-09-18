import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Two jobs, and only the first of them is about security-adjacent behaviour.
 *
 * **Keeping a session fresh.** A Server Component cannot write cookies, so when
 * an access token is close to expiring the refreshed one has to be set here,
 * before the page renders.
 *
 * **Putting the admin panel on its own subdomain.** admin.tasbihcounts.com is
 * served by this same application (docs/ADMIN.md §1); its requests are rewritten
 * onto the /admin routes, and the same routes are hidden on the main domain. A
 * rewrite, not a redirect: the address bar keeps saying admin.tasbihcounts.com,
 * and the session cookie stays on the host it was set for.
 *
 * Neither job is an access check. docs/SECURITY.md §3: a proxy can be skipped —
 * two 2026 CVEs did exactly that — so every admin page and action calls
 * requireAdmin() itself, and scripts/check-admin-guards.mjs fails the build on
 * any that does not. Hiding /admin on the main domain below is tidiness, not a
 * boundary: an admin who reached it there would still have to pass that guard.
 */

/** The host the panel answers on. Anything else is the site. */
function isAdminHost(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];
  return host.split(".")[0] === "admin";
}

/**
 * Paths that mean the same thing on both hosts and must NOT be rewritten.
 *
 * /auth/callback/ is the one that matters and the one that caught this out:
 * Google returns the operator to whichever host started the sign-in, so the
 * callback has to run on admin.tasbihcounts.com — and a rewrite would have sent
 * it to /admin/auth/callback/, which does not exist. Sign-in would have failed
 * at the last step, with Google reporting success.
 *
 * /api and /_next are here for the same reason: one set of routes and one set of
 * assets, shared by both hosts.
 */
const SHARED = /^\/(?:auth|api|_next)(?:\/|$)/;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const adminHost = isAdminHost(request);

  if (adminHost) {
    // admin.tasbihcounts.com/users/ → /admin/users/, and its root → /admin/.
    // Already-prefixed paths pass through, so a link written as /admin/users/
    // works on the subdomain too.
    if (!pathname.startsWith("/admin") && !SHARED.test(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = `/admin${pathname === "/" ? "" : pathname}`;
      return withFreshSession(request, NextResponse.rewrite(url), url.pathname);
    }
  } else if (pathname.startsWith("/admin")) {
    // The panel is not part of the public site. On the main domain it does not
    // exist — which is also what a stranger who guesses the path is told.
    return new NextResponse(null, { status: 404 });
  }

  return withFreshSession(request, NextResponse.next({ request }), pathname);
}

/**
 * Which paths have a session worth refreshing.
 *
 * The matcher below has to see nearly every request, because the subdomain
 * rewrite happens before routing. That must not turn into a Supabase round trip
 * on every visit to a prerendered page — the counter is the product and it is
 * opened on slow networks. So the refresh is gated here, on the same three
 * places it covered before the panel moved in.
 *
 * The path checked is the REWRITTEN one, so /users/ on the admin subdomain is
 * seen as /admin/users/ and is covered.
 */
const NEEDS_SESSION = /^\/(?:admin|account|api\/account)(?:\/|$)/;

/**
 * Refreshes the Supabase session onto whichever response we are returning.
 *
 * The refreshed cookies have to land on the response that is actually sent, so
 * the response is passed in rather than created here — a rewrite and a plain
 * pass-through both need the same treatment.
 */
async function withFreshSession(request: NextRequest, initial: NextResponse, path: string) {
  const response = initial;
  if (!NEEDS_SESSION.test(path)) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  /*
   * The account pages, the admin panel, and — on the admin subdomain — every
   * path, because the rewrite has to happen before routing.
   *
   * /api/account/ too (B52): its routes read the session, and a token that had
   * run out was answered 401 instead of being refreshed.
   *
   * The static files are excluded by name rather than by matching everything:
   * rewriting /_next/static on the subdomain would break the panel's own assets.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|.*\\.(?:png|jpg|svg|ico|txt|xml|webmanifest)$).*)"],
};
