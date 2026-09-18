import { expect, test } from "@playwright/test";

import { liveSupabase } from "./supabase-session";

/**
 * The admin panel's door, and the subdomain it hangs in (docs/ADMIN.md §1, §2).
 *
 * These run through `request` rather than a page, because what is under test is
 * routing and refusal — status codes and redirects — and because the Host header
 * is the whole point. A browser will not let a page choose its own Host; a raw
 * request will, which is how one process can stand in for two hostnames.
 *
 * There is no test here of a signed-in screen. Sign-in is Google and only Google,
 * so a test cannot get past it — which is the intended behaviour and not a gap
 * worth faking with a stubbed session. What these do cover is everything that
 * decides whether a stranger ever reaches those screens.
 */

const ADMIN_HOST = "admin.localhost";

/*
 * One project is enough. Nothing here renders a layout or touches a viewport —
 * these are status codes, redirects and headers, and running them three times on
 * three emulated devices would cost three minutes to learn the same thing. The
 * support view this replaced made the same call.
 */
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "routing and refusal do not vary by device");
});

/** Every route in the panel, including the ones that return files. */
const PANEL_ROUTES = [
  "/admin/",
  "/admin/users/",
  "/admin/users/00000000-0000-4000-8000-000000000001/",
  "/admin/users/export/",
  "/admin/users/00000000-0000-4000-8000-000000000001/export/",
  "/admin/payments/",
  "/admin/payments/order_abcdef/",
  "/admin/payments/export/",
  "/admin/payments/mode/",
  "/admin/webhooks/",
  "/admin/switches/",
  "/admin/names/",
  "/admin/names/radha/",
  "/admin/names/new/",
  "/admin/analytics/",
  "/admin/system/",
  "/admin/audit/",
  "/admin/audit/export/",
];

test.describe("on the main domain", () => {
  for (const path of PANEL_ROUTES) {
    test(`${path} does not exist`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
    });
  }

  test("the site itself is unchanged by the route group", async ({ request }) => {
    // The public pages moved into app/(site)/ so the panel could have its own
    // chrome. Parentheses mean no URL changes — this is what says so.
    for (const path of [
      "/",
      "/premium/",
      "/stats/",
      "/streak/",
      "/about-us/",
      "/blog/",
      "/contact-us/",
      "/terms/",
      "/privacy-policy/",
      "/refund-policy/",
      "/login/",
      "/robots.txt",
      "/sitemap.xml",
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
    }
  });

  test("robots.txt asks crawlers to leave the panel alone", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).toContain("Disallow: /admin");
  });
});

test.describe("on the admin subdomain", () => {
  const withHost = { headers: { Host: ADMIN_HOST }, maxRedirects: 0 } as const;

  test("its root reaches the panel, and the panel asks for sign-in", async ({ request }) => {
    const response = await request.get("/", withHost);
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe("/admin/login/");
  });

  test("a bare path is rewritten into the panel rather than served as the site", async ({
    request,
  }) => {
    // /users/ is not a route on the public site at all. On this host it has to
    // become /admin/users/, which then refuses a signed-out caller.
    for (const path of ["/users/", "/switches/", "/names/", "/payments/", "/audit/"]) {
      const response = await request.get(path, withHost);
      expect(response.status(), path).toBe(307);
      expect(response.headers().location, path).toBe("/admin/login/");
    }
  });

  test("the sign-in page offers Google and nothing else", async ({ request }) => {
    const html = await (await request.get("/admin/login/", { headers: { Host: ADMIN_HOST } })).text();

    expect(html).toContain("Continue with Google");
    // The things Rajan asked not to exist here. A password field or a reset link
    // creeping back in is exactly the regression worth failing a build over.
    expect(html).not.toContain('type="password"');
    expect(html).not.toMatch(/forgot/i);
    // And none of the site's furniture.
    expect(html).not.toContain("adsbygoogle");
  });

  test("the shared routes are not rewritten", async ({ request }) => {
    /*
     * /auth/callback/ is where Google returns the operator, on this host. If the
     * rewrite caught it, it would become /admin/auth/callback/ — which does not
     * exist — and sign-in would fail at the last step while Google reported
     * success. It must behave identically on both hosts.
     */
    const onAdmin = await request.get("/auth/callback/", withHost);
    const onSite = await request.get("/auth/callback/", { maxRedirects: 0 });
    expect(onAdmin.status()).toBe(onSite.status());
    expect(onAdmin.status()).not.toBe(404);

    // /api likewise: one set of routes, shared.
    const api = await request.get("/api/checkout/status/", { headers: { Host: ADMIN_HOST } });
    expect(api.status()).not.toBe(404);
  });

  test("every panel response refuses to be indexed or cached", async ({ request }) => {
    const response = await request.get("/admin/login/", { headers: { Host: ADMIN_HOST } });
    const headers = response.headers();

    expect(headers["x-robots-tag"]).toContain("noindex");
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});

test.describe("who the panel lets in", () => {
  /*
   * Carried over from the support view this panel replaced, and the most
   * valuable test in the file: it is easy to build a door that keeps out
   * strangers and lets in every customer.
   *
   * It runs through `request` with the session as a Cookie header rather than
   * through a browser, because the panel answers on admin.localhost and a cookie
   * set for 127.0.0.1 would not be sent there. The server cannot tell the
   * difference, which is the point.
   */
  test("a signed-in buyer who is not on the admin list gets a 404", async ({ request }) => {
    const live = liveSupabase();
    test.skip(!live, "needs site/.env.local");

    const user = await live!.createUser({ premium: true, host: "127.0.0.1" });
    try {
      const cookie = user.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

      // The panel, on the host it actually answers on, with a real Premium
      // buyer's session attached.
      const response = await request.get("/admin/", {
        headers: { Host: ADMIN_HOST, Cookie: cookie },
        maxRedirects: 0,
      });

      // Not a redirect to sign-in — they ARE signed in. A plain 404, which says
      // nothing about the panel existing or about who could open it.
      expect(response.status()).toBe(404);

      const html = await response.text();
      // The 404 page, not the dashboard. Asserted on what the page renders, not
      // on the title: Next resolves a route's metadata before notFound() takes
      // effect, so "Overview" is in the payload of a page that never rendered.
      expect(html).toContain("This page does not exist");
      // Nothing only a signed-in administrator would ever see.
      expect(html).not.toContain("Sign out");
      expect(html).not.toContain("Billing reconciled");
      expect(html).not.toContain("admin/users/");

      // And the same for a screen that reads other people's data.
      const users = await request.get("/admin/users/", {
        headers: { Host: ADMIN_HOST, Cookie: cookie },
        maxRedirects: 0,
      });
      expect(users.status()).toBe(404);
    } finally {
      await user.remove();
    }
  });

  test("the panel is not in the sitemap", async ({ request }) => {
    const body = await (await request.get("/sitemap.xml")).text();
    expect(body).not.toContain("/admin");
  });
});
