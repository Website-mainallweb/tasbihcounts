import { expect, test, type Page } from "@playwright/test";

import { liveSupabase } from "./supabase-session";
import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * Reminders (ARCHITECTURE §6, Phase 11), as far as a machine may test them.
 *
 * Nothing here asks for notification permission or reaches Firebase: this browser
 * is kept off the network, so no push token can be minted. What is tested is the
 * account page's reminders block on every layout, who sees it, and that the new
 * routes refuse a caller without a user or without the scheduler's secret.
 */

const HOST = "127.0.0.1";

let assertNoProductionTraffic: (() => void) | undefined;

test.beforeEach(async ({ page }) => {
  await blockThirdParty(page);
  assertNoProductionTraffic = watchForProductionRequests(page);
});

test.afterEach(() => {
  assertNoProductionTraffic?.();
  assertNoProductionTraffic = undefined;
});

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("reminders on the account page", () => {
  test("a Premium account that has used the counter here can switch them on, at a time it picks", async ({
    page,
    context,
  }) => {
    const live = liveSupabase();
    test.skip(!live, "needs site/.env.local");
    const user = await live!.createUser({ premium: true, host: HOST });
    try {
      await context.addCookies(user.cookies);
      // The counter mints this browser's install id; reminders are per device.
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!localStorage.getItem("njc.hot"));

      await page.goto("/account/");
      const block = page.locator(".account-reminders");
      await expect(block.getByRole("heading", { name: "Reminders" })).toBeVisible();

      const toggle = block.getByRole("checkbox", { name: /Remind me on this device/ });
      await expect(toggle).toBeVisible();
      await expect(toggle).not.toBeChecked();

      const time = block.getByRole("combobox");
      await expect(time.locator("option")).toHaveCount(48);
      await expect(time).toHaveValue("1260"); // 9:00 PM
      await expect(block).toContainText("same on every device");

      expect(await sideways(page)).toBeLessThanOrEqual(0);
      const box = await block.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    } finally {
      await user.remove();
    }
  });

  test("before the counter has run in this browser, it says to open the counter first", async ({ page, context }) => {
    const live = liveSupabase();
    test.skip(!live, "needs site/.env.local");
    const user = await live!.createUser({ premium: true, host: HOST });
    try {
      await context.addCookies(user.cookies);
      await page.goto("/account/");
      const block = page.locator(".account-reminders");
      await expect(block).toContainText("Open the counter once on this device");
      await expect(block.getByRole("checkbox")).toHaveCount(0);
    } finally {
      await user.remove();
    }
  });

  test("an account without Premium is not offered reminders", async ({ page, context }) => {
    const live = liveSupabase();
    test.skip(!live, "needs site/.env.local");
    const user = await live!.createUser({ premium: false, host: HOST });
    try {
      await context.addCookies(user.cookies);
      await page.goto("/account/");
      await expect(page.getByTestId("account-premium")).toHaveText("Not active on this account");
      await expect(page.locator(".account-reminders")).toHaveCount(0);
    } finally {
      await user.remove();
    }
  });
});

test.describe("the reminder routes keep their doors shut", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "server routes: one project is enough");
  });

  test("the scheduler refuses a missing or wrong secret", async ({ request }) => {
    expect((await request.post("/api/cron/reminders/")).status()).toBe(401);
    expect(
      (await request.post("/api/cron/reminders/", { headers: { authorization: "Bearer not-the-cron-secret-0123456789abcdef" } })).status(),
    ).toBe(401);
  });

  test("registering, unregistering and reading settings all need a signed-in user", async ({ request }) => {
    expect((await request.post("/api/push/register/", { data: { sourceId: "x", token: "t".repeat(30) } })).status()).toBe(401);
    expect((await request.post("/api/push/unregister/", { data: { sourceId: "x" } })).status()).toBe(401);
    expect((await request.get("/api/reminders/")).status()).toBe(401);
    expect(
      (await request.post("/api/reminders/", { data: { enabled: true, zone: "Asia/Kolkata", remindAt: 1260 } })).status(),
    ).toBe(401);
  });

  test("a forged bearer token is refused", async ({ request }) => {
    const res = await request.post("/api/push/register/", {
      data: { sourceId: "x", token: "t".repeat(30) },
      headers: { authorization: `Bearer ${"a".repeat(40)}.${"b".repeat(40)}.${"c".repeat(40)}` },
    });
    expect(res.status()).toBe(401);
  });
});
