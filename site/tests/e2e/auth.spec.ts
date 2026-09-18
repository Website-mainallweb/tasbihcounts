import { expect, test, type Page } from "@playwright/test";

import { liveSupabase } from "./supabase-session";
import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * Sign-in for Premium buyers (ARCHITECTURE §6, Phase 8).
 *
 * The browser is kept off the network as everywhere else: the sign-in page's own
 * calls to Supabase and Google are not exercised here, since Google sign-in needs
 * a person and the email link needs an inbox. What is tested is everything the
 * site decides: the page, its errors, where the callback sends people, that the
 * account page is closed to strangers, and — with a real session minted on the
 * live project — that a signed-in buyer sees their account and can sign out.
 */

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

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* The sign-in card's own message. Not getByRole("alert") on the page: Next adds
   an empty role="alert" route announcer to every page. */
const loginAlert = (page: Page) => page.locator(".auth-card [role=alert]");

test.describe("the sign-in page", () => {
  for (const [name, width, height] of [
    ["phone", 375, 812],
    ["tablet", 768, 1024],
    ["desktop", 1440, 900],
  ] as const) {
    test(`${name}: renders whole, with every way in`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/login/");
      await expect(page.locator("main h1")).toHaveText("Log in to Tasbih Counts");
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
      await expect(page.getByLabel("Email address")).toBeVisible();
      // A password is the first way in since 2026-09-12; the email link and the
      // reset are a click away, because an email can be slow or eaten.
      await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Forgot password?" })).toBeVisible();
      await page.getByRole("button", { name: "Log in with an email code instead" }).click();
      await expect(page.getByRole("button", { name: /^Email me a (code|sign-in link)$/ })).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);

      const card = await page.locator(".auth-card").boundingBox();
      expect(card!.x).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width).toBeLessThanOrEqual(width);
    });
  }

  test("desktop puts the explanation beside the form, a phone puts the form first", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login/");
    const [intro, card] = await Promise.all([
      page.locator(".auth-intro").boundingBox(),
      page.locator(".auth-card").boundingBox(),
    ]);
    expect(card!.x).toBeGreaterThan(intro!.x + intro!.width - 1);

    await page.setViewportSize({ width: 375, height: 812 });
    const [introPhone, cardPhone] = await Promise.all([
      page.locator(".auth-intro").boundingBox(),
      page.locator(".auth-card").boundingBox(),
    ]);
    // B24: the email field on screen without scrolling past the explanation.
    expect(introPhone!.y).toBeGreaterThan(cardPhone!.y + cardPhone!.height - 1);
    expect(cardPhone!.y).toBeLessThan(812);
  });

  test("is not offered to search engines", async ({ page }) => {
    await page.goto("/login/");
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
  });

  test("explains a sign-in that found no purchase", async ({ page }) => {
    await page.goto("/login/?error=no_account");
    await expect(loginAlert(page)).toContainText("same email address you used to pay");
  });

  test("ignores an error name it does not know", async ({ page }) => {
    await page.goto("/login/?error=%3Cscript%3E");
    await expect(page.locator(".auth-card")).toBeVisible();
    await expect(loginAlert(page)).toHaveCount(0);
  });
});

test.describe("the account page and the callback", () => {
  test("a visitor who is not signed in is sent to sign in", async ({ page }) => {
    await page.goto("/account/");
    await expect(page).toHaveURL(/\/login\/\?next=(\/|%2F)account(\/|%2F)$/);
  });

  test("the callback without a code goes back to sign in with an error", async ({ page }) => {
    await page.goto("/auth/callback/");
    await expect(page).toHaveURL(/\/login\/\?error=failed$/);
  });

  test("a Google account with no purchase is told to use the email they paid with", async ({ page }) => {
    await page.goto(
      "/auth/callback/?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance",
    );
    await expect(page).toHaveURL(/\/login\/\?error=no_account$/);
    await expect(loginAlert(page)).toContainText("same email address you used to pay");
  });

  /* #38: the "Premium is ready" email and the login email use the implicit flow,
     so they come back with the session in the fragment and no code. That used to
     end in "Sign-in did not work"; now the browser carries the fragment on to
     /auth/confirm/, which stores the session and wipes the address bar. */
  test("an email link with its session in the fragment reaches the confirm page, which clears it", async ({ page }) => {
    await page.goto("/auth/callback/?next=/account/#access_token=not-a-jwt&refresh_token=x&type=magiclink");
    // A forged token is refused by Supabase, so this one ends at sign-in — but
    // it got past the callback, and the tokens left the address bar.
    await expect(page).toHaveURL(/\/login\/\?error=(failed|link_expired)$/);
    expect(page.url()).not.toContain("access_token");
  });

  test("an expired email link is told so in plain words", async ({ page }) => {
    await page.goto(
      "/auth/confirm/?next=/account/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    await expect(page).toHaveURL(/\/login\/\?error=link_expired$/);
    await expect(loginAlert(page)).toContainText("expired");
  });

  /* A relative Location, always. An absolute one is built from the host the
     server thinks it is — behind a reverse proxy that is its own internal
     address, which would send a real user somewhere unreachable. */
  for (const [label, path, expected] of [
    ["an error", "/auth/callback/?error=x&next=//evil.example/", "/login/?error=failed"],
    ["no code", "/auth/callback/?next=https://evil.example/", "/auth/confirm/?next=/account/"],
  ] as const) {
    test(`the callback with ${label} redirects on this site only`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(303);
      expect(res.headers()["location"]).toBe(expected);
    });
  }
});

test.describe("a signed-in buyer", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "one live session per run is enough");
    test.skip(!liveSupabase(), "needs site/.env.local with Supabase keys");
  });

  test("sees their account and Premium, and can sign out", async ({ page, context }) => {
    const live = liveSupabase()!;
    const user = await live.createUser({ premium: true, host: "127.0.0.1" });
    try {
      await context.addCookies(user.cookies);

      // The device's own last round trip, which the server render cannot know (#21).
      await page.addInitScript(() => {
        localStorage.setItem("njc.synced", String(Date.now()));
      });

      await page.goto("/account/");
      await expect(page.getByTestId("account-email")).toHaveText(user.email);
      await expect(page.getByTestId("account-premium")).toHaveText("Active — lifetime");
      await expect(page.getByTestId("account-synced")).toContainText("just now");

      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);

      await page.goto("/account/");
      await expect(page).toHaveURL(/\/login\/\?next=(\/|%2F)account(\/|%2F)$/);
    } finally {
      await user.remove();
    }
  });

  test("a signed-in visitor who opens /login/ goes straight on, to this site only", async ({ page, context }) => {
    const live = liveSupabase()!;
    const user = await live.createUser({ premium: true, host: "127.0.0.1" });
    try {
      await context.addCookies(user.cookies);
      await page.goto("/login/");
      await expect(page).toHaveURL(/\/account\/$/);
      await page.goto("/login/?next=//evil.example/");
      await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/account\/$/);
      await page.goto("/login/?next=/stats/");
      await expect(page).toHaveURL(/\/stats\/$/);
      // No password form on the account page any more: a link by email instead.
      await page.goto("/account/");
      await expect(page.locator("input[type=password]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Email me a password link" })).toBeVisible();
    } finally {
      await user.remove();
    }
  });

  test("without Premium, the account says so and how to get help", async ({ page, context }) => {
    const live = liveSupabase()!;
    const user = await live.createUser({ premium: false, host: "127.0.0.1" });
    try {
      await context.addCookies(user.cookies);
      await page.goto("/account/");
      await expect(page.getByTestId("account-premium")).toHaveText("Not active on this account");
      await expect(page.getByText(/Razorpay payment ID/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Get Premium" }).first()).toBeVisible();
    } finally {
      await user.remove();
    }
  });
});

test.describe("choosing a new password from the email", () => {
  test("the page without a token says the link cannot be used, and offers a new one", async ({ page }) => {
    await page.goto("/auth/reset/");
    await expect(page.getByRole("heading", { name: "This link cannot be used" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Send me a new link" })).toHaveAttribute("href", "/login/?mode=forgot");
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
  });

  test("opening the link spends nothing and wipes the token from the address bar", async ({ page }) => {
    await page.goto("/auth/reset/?token_hash=pkce_abcdef0123456789&type=recovery");
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
    const submit = page.getByRole("button", { name: "Set new password" });
    await expect(submit).toBeDisabled();
    await page.getByLabel("New password").fill("short1");
    await expect(submit).toBeDisabled();
    await page.getByLabel("New password").fill("a long phrase 108");
    await page.getByLabel("Type it again").fill("a long phrase 108");
    await expect(submit).toBeEnabled();
  });

  test("the route refuses a weak password before touching the token, and a bad token plainly", async ({ request }) => {
    test.skip(!liveSupabase(), "needs site/.env.local with Supabase keys");
    const weak = await request.post("/api/auth/reset/", { data: { token_hash: "pkce_abcdef0123456789", password: "abc" } });
    expect(weak.status()).toBe(400);
    expect(await weak.json()).toEqual({ error: "short" });

    const forged = await request.post("/api/auth/reset/", {
      data: { token_hash: "pkce_abcdef0123456789", password: "a long phrase 108" },
    });
    expect(forged.status()).toBe(400);
    expect(await forged.json()).toEqual({ error: "link_expired" });

    // No token and no recovery session: refused, not a way round the current password.
    const none = await request.post("/api/auth/reset/", { data: { password: "a long phrase 108" } });
    expect(await none.json()).toEqual({ error: "link_expired" });

    const junk = await request.post("/api/auth/reset/", { data: { token_hash: "<script>", password: "a long phrase 108" } });
    expect(await junk.json()).toEqual({ error: "link_expired" });
  });
});