import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { liveSupabase, type TempUser } from "./supabase-session";
import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * Sync between two browsers of one Premium account (ARCHITECTURE §6, Phase 10).
 *
 * Real Supabase, a temporary Premium user, two browser contexts — two separate
 * installations, each with its own storage and its own source id. What must hold:
 *
 *   - taps on one reach the other, added, not overwritten
 *   - a tap the server has confirmed can no longer be undone or reset away
 *   - a browser that is not signed in never calls the sync routes at all
 */

const HOST = "127.0.0.1";
const SYNC = /\/api\/sync\/$/;
const PULL = /\/api\/sync\/pull\/$/;

test.describe.configure({ mode: "serial" });

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "live account: one project is enough");
});

let guards: (() => void)[] = [];

test.afterEach(() => {
  for (const g of guards) g();
  guards = [];
});

async function openCounter(page: Page) {
  await blockThirdParty(page);
  guards.push(watchForProductionRequests(page));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!localStorage.getItem("njc.hot"));
}

async function pickAName(page: Page) {
  await page.evaluate(() => document.getElementById("njcSelectBar")!.click());
  await page.waitForSelector("#njcAllList [data-id]");
  await page.evaluate(() => {
    (document.querySelector("#njcAllList [data-id]") as HTMLElement).click();
    (document.querySelector("#shName [data-close]") as HTMLElement | null)?.click();
  });
}

async function tap(page: Page, times: number) {
  await page.evaluate((n) => {
    const s = document.getElementById("njcSurface")!;
    for (let i = 0; i < n; i++) {
      s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 400 }));
      s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 300, clientY: 400 }));
    }
  }, times);
}

const digits = (page: Page) => page.evaluate(() => document.getElementById("njcDigits")!.textContent);
const today = (page: Page) => page.evaluate(() => document.getElementById("njcPToday")!.textContent);
const hot = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("njc.hot") || "null") as {
    outbox: Record<string, unknown>;
    watermark: Record<string, { c: number }>;
    rec: { c: number } | null;
  });

async function signedIn(context: BrowserContext, user: TempUser) {
  await context.addCookies(user.cookies.map((c) => ({ ...c, domain: HOST })));
}

test.describe("two browsers, one account", () => {
  let user: TempUser | undefined;

  test.beforeAll(async () => {
    const live = liveSupabase();
    if (live) user = await live.createUser({ premium: true, host: HOST });
  });

  test.afterAll(async () => {
    await user?.remove();
  });

  test("taps on one browser show up on the other, and confirmed taps stay put", async ({ browser }) => {
    test.skip(!user, "needs site/.env.local");
    test.setTimeout(90_000);

    const ctxA = await browser.newContext();
    await signedIn(ctxA, user!);
    const a = await ctxA.newPage();
    await openCounter(a);
    await pickAName(a);

    const sent = a.waitForResponse((r) => SYNC.test(r.url()) && r.request().method() === "POST", { timeout: 30_000 });
    await tap(a, 5);
    expect((await sent).status()).toBe(200);

    // Acknowledged: nothing owed, and the server's value is the watermark.
    await expect.poll(async () => Object.keys((await hot(a)).outbox).length).toBe(0);
    const marks = Object.values((await hot(a)).watermark);
    expect(marks.map((m) => m.c)).toEqual([5]);

    // A confirmed tap cannot be undone: GREATEST would bring it straight back.
    await a.locator("#njcUndo").click({ force: true });
    await expect.poll(() => digits(a)).toBe("5");

    // Nor erased by "reset today".
    await a.evaluate(() => (document.getElementById("njcRToday") as HTMLElement).click());
    await expect.poll(async () => (await hot(a)).rec?.c).toBe(5);

    // A second installation of the same account sees those five as its own day.
    const ctxB = await browser.newContext();
    await signedIn(ctxB, user!);
    const b = await ctxB.newPage();
    const pulled = b.waitForResponse((r) => PULL.test(r.url()), { timeout: 30_000 });
    await openCounter(b);
    expect((await pulled).status()).toBe(200);
    await expect.poll(() => today(b)).toBe("5");

    // And its own taps add to them rather than replacing them.
    await pickAName(b);
    const sentB = b.waitForResponse((r) => SYNC.test(r.url()) && r.request().method() === "POST", { timeout: 30_000 });
    await tap(b, 3);
    expect((await sentB).status()).toBe(200);
    await expect.poll(() => today(b)).toBe("8");

    // Back on the first browser, a pull brings the other device's three in.
    const pulledA = a.waitForResponse((r) => PULL.test(r.url()), { timeout: 30_000 });
    await a.reload({ waitUntil: "domcontentloaded" });
    expect((await pulledA).status()).toBe(200);
    await expect.poll(() => today(a)).toBe("8");

    await ctxA.close();
    await ctxB.close();
  });
});

/* docs/SPEC.md §6, added 2026-09-11: a device own practice is never mixed into an
   account that already has one without asking, and signing out takes the account
   practice off the device.

   Each test makes its own account: signing out at the end of one revokes the
   session its cookies carry, so a shared account would leave the next test
   signed out and unlinked. */
test.describe("a device with a practice of its own", () => {
  const sentOk = (page: Page) =>
    page.waitForResponse((r) => SYNC.test(r.url()) && r.request().method() === "POST", { timeout: 30_000 });

  /** Another browser of the same account, so the account already has a practice. */
  async function seedAccount(browser: Browser, user: TempUser, taps: number) {
    const ctx = await browser.newContext();
    await signedIn(ctx, user);
    const page = await ctx.newPage();
    await openCounter(page);
    await pickAName(page);
    const sent = sentOk(page);
    await tap(page, taps);
    expect((await sent).status()).toBe(200);
    await ctx.close();
  }

  test("an old account keeps its practice; the device own is set aside, offered, and added on request", async ({ browser }) => {
    const live = liveSupabase();
    test.skip(!live, "needs site/.env.local");
    test.setTimeout(120_000);
    const user = await live!.createUser({ premium: true, host: HOST });
    try {
      await seedAccount(browser, user, 6);

      // This browser counted four for free, before ever signing in.
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await openCounter(page);
      await pickAName(page);
      await tap(page, 4);
      await expect.poll(() => today(page)).toBe("4");

      // Signed in, it shows the account six — the four are set aside, not mixed in.
      await signedIn(ctx, user);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect.poll(() => today(page), { timeout: 30_000 }).toBe("6");
      const ask = page.locator(".njc-notice", { hasText: "from before you signed in" });
      await expect(ask).toContainText("4 chants");
      expect(await page.evaluate(() => !!localStorage.getItem("njc.stash"))).toBe(true);

      // Asked for, they go up as one more device and are added: ten.
      const added = sentOk(page);
      await ask.getByRole("button", { name: "Add to my account" }).click();
      expect((await added).status()).toBe(200);
      await expect.poll(() => today(page), { timeout: 30_000 }).toBe("10");
      expect(await page.evaluate(() => localStorage.getItem("njc.stash"))).toBeNull();

      await ctx.close();
    } finally {
      await user.remove();
    }
  });

  test("signing out gives the device back the practice it had before sign-in", async ({ browser }) => {
    const live = liveSupabase();
    test.skip(!live, "needs site/.env.local");
    test.setTimeout(120_000);
    const user = await live!.createUser({ premium: true, host: HOST });
    try {
      await seedAccount(browser, user, 5);

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await openCounter(page);
      await pickAName(page);
      await tap(page, 3);
      await expect.poll(() => today(page)).toBe("3");

      await signedIn(ctx, user);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect.poll(() => today(page), { timeout: 30_000 }).toBe("5");
      expect(await page.evaluate(() => !!localStorage.getItem("njc.stash"))).toBe(true);

      // Signing out sends anything unsent, then hands the device back its own three.
      await page.goto("/account/");
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
      await page.waitForFunction(() => !!localStorage.getItem("njc.hot"));
      await expect.poll(() => today(page)).toBe("3");
      expect(await page.evaluate(() => localStorage.getItem("njc.stash"))).toBeNull();

      await ctx.close();
    } finally {
      await user.remove();
    }
  });
});

test("a browser that is not signed in never calls the sync routes", async ({ page }) => {
  test.setTimeout(45_000);
  const calls: string[] = [];
  page.on("request", (r) => {
    if (SYNC.test(r.url()) || PULL.test(r.url())) calls.push(r.url());
  });

  await openCounter(page);
  await pickAName(page);
  await tap(page, 3);
  // Longer than the 10 s idle debounce, so a flush would have happened by now.
  await page.waitForTimeout(12_000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);

  expect(calls).toEqual([]);
});
