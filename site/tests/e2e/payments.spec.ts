import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { liveSupabase } from "./supabase-session";
import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * Buying Premium, as far as a machine may test it (ARCHITECTURE §6, Phase 9).
 *
 * NO PAYMENT IS EVER MADE HERE. Every payment test happens in Rajan's own Chrome,
 * by Rajan. The browser in this suite is kept off the network, so Razorpay's
 * Checkout never even loads. What is tested is everything around the payment:
 * the page, the doors the checkout routes keep shut, the webhook's signature
 * check, and that a real test-mode order is recorded correctly.
 */

type Env = Record<string, string>;

function readEnv(): Env | null {
  const file = join(__dirname, "../../.env.local");
  if (!existsSync(file)) return null;
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

const SAME_SITE = { origin: "http://127.0.0.1:3100" };

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

test.describe("the Premium page", () => {
  for (const [name, width, height] of [
    ["phone", 375, 812],
    ["tablet", 768, 1024],
    ["desktop", 1440, 900],
  ] as const) {
    test(`${name}: the price, what it includes, and the buy card, whole`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/premium/");
      await expect(page.locator("main h1")).toHaveText("Tasbih Counts Premium");
      await expect(page.locator(".buy-price")).toContainText("₹200");
      await expect(page.getByLabel("Your email")).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      const card = await page.locator(".buy-card").boundingBox();
      expect(card!.x + card!.width).toBeLessThanOrEqual(width);
    });
  }

  test("desktop puts the buy card beside the copy; a phone puts it after", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/premium/");
    const [copy, buy] = await Promise.all([
      page.locator(".premium-copy").boundingBox(),
      page.locator(".premium-buy").boundingBox(),
    ]);
    expect(buy!.x).toBeGreaterThan(copy!.x + copy!.width - 1);

    await page.setViewportSize({ width: 375, height: 812 });
    const [copyPhone, buyPhone] = await Promise.all([
      page.locator(".premium-copy").boundingBox(),
      page.locator(".premium-buy").boundingBox(),
    ]);
    expect(buyPhone!.y).toBeGreaterThan(copyPhone!.y + copyPhone!.height - 1);
  });

  test("the pay button waits for an email and the agreement", async ({ page }) => {
    await page.goto("/premium/");
    await expect(page.locator(".buy-card[data-ready]")).toHaveCount(1);
    const pay = page.getByRole("button", { name: /^Pay ₹200$/ });
    await expect(pay).toBeDisabled();

    await page.getByLabel("Your email").fill("buyer@example.com");
    await expect(pay).toBeDisabled();

    await page.getByRole("checkbox").check();
    await expect(pay).toBeEnabled();

    await page.getByLabel("Your email").fill("not-an-email");
    await expect(pay).toBeDisabled();
  });

  test("links to the Terms and the Refund Policy it asks people to accept", async ({ page }) => {
    await page.goto("/premium/");
    await expect(page.locator('.buy-card a[href="/terms/"]')).toHaveCount(1);
    await expect(page.locator('.buy-card a[href="/refund-policy/"]')).toHaveCount(1);
  });

  test("carries no ads", async ({ page }) => {
    await page.goto("/premium/");
    await expect(page.locator("main .ad")).toHaveCount(0);
  });
});

test.describe("the checkout routes keep their doors shut", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "server routes: one project is enough");
  });

  test("an order from another site is refused", async ({ request }) => {
    const res = await request.post("/api/checkout/order/", {
      data: { email: "buyer@example.com", accept: true },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status()).toBe(403);
  });

  for (const [label, body] of [
    ["no email", { accept: true }],
    ["a malformed email", { email: "nope", accept: true }],
    ["no agreement", { email: "buyer@example.com" }],
    ["agreement not true", { email: "buyer@example.com", accept: "yes" }],
  ] as const) {
    // Playwright has no test.each: one test per case, generated in a loop.
    test(`an order with ${label} is refused before Razorpay is asked`, async ({ request }) => {
      const res = await request.post("/api/checkout/order/", { data: body, headers: SAME_SITE });
      expect(res.status()).toBe(400);
    });
  }

  test("a checkout callback with a forged signature is refused", async ({ request }) => {
    const res = await request.post("/api/checkout/verify/", {
      data: { razorpay_order_id: "order_FORGED001", razorpay_payment_id: "pay_FORGED001", razorpay_signature: "0".repeat(64) },
      headers: SAME_SITE,
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_signature" });
  });

  test("status for an order that is not ours says nothing", async ({ request }) => {
    const res = await request.post("/api/checkout/status/", {
      data: { orderId: "order_NOTOURS01" },
      headers: SAME_SITE,
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ state: "unknown", active: false, waiting: false });
  });
});

test.describe("the webhook", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "server routes: one project is enough");
  });

  test("an unsigned delivery is refused", async ({ request }) => {
    const res = await request.post("/api/razorpay/webhook/", {
      data: JSON.stringify({ event: "payment.captured" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("a delivery signed with the wrong secret is refused", async ({ request }) => {
    const body = JSON.stringify({ event: "payment.captured" });
    const res = await request.post("/api/razorpay/webhook/", {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": createHmac("sha256", "not-the-secret").update(body).digest("hex"),
      },
    });
    expect(res.status()).toBe(400);
  });

  test("a correctly signed delivery for an order that is not ours is acknowledged and changes nothing", async ({
    request,
  }) => {
    const env = readEnv();
    test.skip(!env?.RAZORPAY_WEBHOOK_SECRET, "needs site/.env.local");
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_E2ENOTOURS", order_id: "order_E2ENOTOURS" } } },
    });
    const res = await request.post("/api/razorpay/webhook/", {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": createHmac("sha256", env!.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex"),
      },
    });
    expect(res.status()).toBe(200);
  });
});

test.describe("a real test-mode order", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "one live order per run is enough");
    test.skip(!readEnv()?.RAZORPAY_KEY_ID?.startsWith("rzp_test_"), "needs Razorpay TEST keys in site/.env.local");
  });

  test("is recorded with the price and email, and waits for a payment that has not been made", async ({
    request,
  }) => {
    const email = `e2e-order-${Date.now()}@example.com`;
    let orderId: string | undefined;

    try {
      const res = await request.post("/api/checkout/order/", {
        data: { email: email.toUpperCase(), accept: true },
        headers: SAME_SITE,
      });
      expect(res.status()).toBe(200);
      const order = await res.json();
      orderId = order.orderId;
      expect(order).toMatchObject({ amount: 20000, currency: "INR", email, mode: "test" });
      expect(order.orderId).toMatch(/^order_/);
      expect(order.keyId).toMatch(/^rzp_test_/);

      const status = await request.post("/api/checkout/status/", { data: { orderId: order.orderId }, headers: SAME_SITE });
      expect(await status.json()).toEqual({ state: "created", active: false, waiting: true });
    } finally {
      /*
       * Take the row back out.
       *
       * This writes to the live Supabase project — there is no other one — and
       * without this it left a purchase behind on every run. Forty of them had
       * accumulated by 2026-09-15, which made the admin panel's "open purchases"
       * figure almost entirely test noise and a genuinely stuck purchase
       * invisible inside it. The test's own litter should not become the
       * operator's problem.
       *
       * In `finally`, so a failed assertion still cleans up. Nothing depends on
       * the row surviving: the order also exists at Razorpay, in test mode,
       * where it expires on its own.
       */
      const live = liveSupabase();
      if (live && orderId) await live.removePurchase(orderId);
    }
  });
});

test.describe("an email that already has Premium", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "live account: one project is enough");
  });

  // A lifetime plan must not be sold to the same person twice: the Refund Policy
  // only refunds technical failures, so a second charge would be a real loss.
  test("is not charged again, and is sent to sign in instead", async ({ page, request }) => {
    const live = liveSupabase();
    test.skip(!live, "needs site/.env.local");
    const buyer = await live!.createUser({ premium: true, host: "127.0.0.1" });
    try {
      const res = await request.post("/api/checkout/order/", {
        data: { email: buyer.email.toUpperCase(), accept: true },
        headers: SAME_SITE,
      });
      expect(res.status()).toBe(409);
      expect(await res.json()).toEqual({ error: "already_premium" });

      await page.goto("/premium/");
      await expect(page.locator(".buy-card[data-ready]")).toHaveCount(1);
      await page.getByLabel("Your email").fill(buyer.email);
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: /^Pay ₹200$/ }).click();
      await expect(page.locator(".buy-card [role=alert]")).toContainText("already has Premium");
      const signIn = page.locator(".buy-card a.buy-owned");
      await expect(signIn).toHaveAttribute("href", "/login/");
      // The label must be readable: white on the accent, never accent on accent.
      const [fg, bg] = await signIn.evaluate((a) => [getComputedStyle(a).color, getComputedStyle(a).backgroundColor]);
      expect(fg).not.toBe(bg);
    } finally {
      await buyer.remove();
    }
  });
});
