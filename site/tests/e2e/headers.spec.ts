import { expect, test } from "@playwright/test";

/**
 * Who may frame this site (next.config.mjs, 2026-09-12).
 *
 * AdSense opens the live site inside its Ad Settings Preview on
 * adsense.google.com, and with framing refused outright that pane can only show
 * the browser's error page. So the public pages name that preview — and every
 * surface with a session or a price on it refuses framing altogether, which is
 * stricter than the SAMEORIGIN they carried before.
 */

const frameAncestors = (csp: string | undefined) =>
  (csp ?? "").split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-ancestors")) ?? "";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "headers do not vary by viewport");
});

test("the public pages may be framed by the AdSense preview, and by nobody else", async ({ request }) => {
  for (const path of ["/", "/about-us/", "/contact-us/", "/privacy-policy/"]) {
    const res = await request.get(path);
    const csp = frameAncestors(res.headers()["content-security-policy"]);
    expect(csp, path).toContain("'self'");
    expect(csp, path).toContain("https://adsense.google.com");
    // X-Frame-Options cannot name a third party, so it must not contradict the CSP.
    expect(res.headers()["x-frame-options"], path).toBeUndefined();
  }
});

test("nothing may frame the account, sign-in, premium or API routes", async ({ request }) => {
  for (const path of ["/account/", "/login/", "/premium/", "/auth/confirm/", "/api/sync/"]) {
    const res = await request.get(path, { maxRedirects: 0, failOnStatusCode: false });
    expect(frameAncestors(res.headers()["content-security-policy"]), path).toBe("frame-ancestors 'none'");
    expect(res.headers()["x-frame-options"], path).toBe("DENY");
  }
});
