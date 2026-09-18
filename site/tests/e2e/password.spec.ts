import { expect, test, type Page } from "@playwright/test";

import { liveSupabase, type TempUser } from "./supabase-session";
import { blockThirdParty } from "./third-party";

/**
 * Logging in with a password, and choosing one (Rajan, 2026-09-12; redesign
 * 2026-09-13).
 *
 * The account is still created only by a payment. A password is chosen through
 * the reset email: its link opens /auth/reset/, which spends the token only when
 * "Set new password" is pressed. There is no password form on the account page.
 * What must hold:
 *
 *   - the right password logs in, through /api/auth/password/
 *   - a wrong one says the same thing for every kind of refusal
 *   - guessing gets shut out, per address
 *   - the reset link sets a password that works on the next log-in, and is
 *     spent once
 *   - opening the link (a mail scanner) spends nothing
 *   - "forgot password" answers the same whether or not the account exists
 */

const HOST = "127.0.0.1";

test.describe.configure({ mode: "serial" });

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "live account: one project is enough");
  test.skip(!liveSupabase(), "needs site/.env.local with Supabase keys");
});

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login/");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

const alert = (page: Page) => page.locator(".auth-card .auth-alert");
const toLogin = /\/login\/(\?next=(\/|%2F)account(\/|%2F))?$/;

test("the right password logs in; a wrong one says so without naming what was wrong", async ({ page, context }) => {
  test.setTimeout(90_000);
  const live = liveSupabase()!;
  const user: TempUser = await live.createUser({ premium: true, host: HOST });
  try {
    await blockThirdParty(page);

    await logIn(page, user.email, "not-the-password-at-all");
    await expect(alert(page)).toContainText("do not match an account");
    await page.goto("/account/");
    await expect(page).toHaveURL(toLogin);

    await logIn(page, `nobody-${Date.now()}@example.com`, "not-the-password-at-all");
    await expect(alert(page)).toContainText("do not match an account");

    await logIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/account\/$/);
    await expect(page.getByTestId("account-email")).toHaveText(user.email);

    await context.clearCookies();
  } finally {
    await user.remove();
  }
});

test("guessing at one address is shut out", async ({ page }) => {
  test.setTimeout(90_000);
  const live = liveSupabase()!;
  const user: TempUser = await live.createUser({ premium: true, host: HOST });
  try {
    await blockThirdParty(page);
    for (let i = 0; i < 6; i++) await logIn(page, user.email, `guess-number-${i}`);
    await expect(alert(page)).toContainText(/do not match|Too many attempts/);

    await logIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/login\/$/);
    await expect(alert(page)).toContainText("Too many attempts");
  } finally {
    await user.remove();
  }
});

test("the reset link sets a new password that works next time, and is spent once", async ({ page, context }) => {
  test.setTimeout(150_000);
  const live = liveSupabase()!;
  const user: TempUser = await live.createUser({ premium: true, host: HOST });
  const chosen = `chosen ${Date.now()} phrase`;
  try {
    await blockThirdParty(page);
    const hash = await live.recoveryHash(user.email);
    const link = `/auth/reset/?token_hash=${hash}&type=recovery`;

    // A scanner opening the link first: a page, nothing spent.
    const scan = await page.request.get(link);
    expect(scan.status()).toBe(200);
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

    await page.getByLabel("New password").fill(chosen);
    await page.getByLabel("Type it again").fill(chosen);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();
    await expect(page).toHaveURL(/\/account\/$/, { timeout: 15_000 });

    // The new password logs in; the old one no longer does.
    await context.clearCookies();
    await logIn(page, user.email, user.password);
    await expect(alert(page)).toContainText("do not match an account");
    await logIn(page, user.email, chosen);
    await expect(page).toHaveURL(/\/account\/$/);

    // The same link again is refused.
    await context.clearCookies();
    await page.goto(link);
    await page.getByLabel("New password").fill(`${chosen} again 2`);
    await page.getByLabel("Type it again").fill(`${chosen} again 2`);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByRole("heading", { name: "This link cannot be used" })).toBeVisible();
  } finally {
    await context.clearCookies();
    await user.remove();
  }
});

test("a password containing the address is refused, and the retry needs no new link", async ({ page, context }) => {
  test.setTimeout(120_000);
  const live = liveSupabase()!;
  const user: TempUser = await live.createUser({ premium: true, host: HOST });
  try {
    await blockThirdParty(page);
    await page.goto(`/auth/reset/?token_hash=${await live.recoveryHash(user.email)}&type=recovery`);
    const local = user.email.split("@")[0];
    await page.getByLabel("New password").fill(`${local} 2026`);
    await page.getByLabel("Type it again").fill(`${local} 2026`);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(alert(page)).toContainText("email address");

    const ok = `quiet mind ${Date.now()}`;
    await page.getByLabel("New password").fill(ok);
    await page.getByLabel("Type it again").fill(ok);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();

    await context.clearCookies();
    await logIn(page, user.email, ok);
    await expect(page).toHaveURL(/\/account\/$/);
  } finally {
    await context.clearCookies();
    await user.remove();
  }
});

test("the account page offers the password link, not a form", async ({ page, context }) => {
  test.setTimeout(90_000);
  const live = liveSupabase()!;
  const user: TempUser = await live.createUser({ premium: true, host: HOST });
  try {
    await blockThirdParty(page);
    await context.addCookies(user.cookies.map((c) => ({ ...c, domain: HOST })));
    await page.goto("/account/");
    await expect(page.locator("input[type=password]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Email me a password link" })).toBeVisible();
    // The old route is gone.
    const res = await page.request.post("/api/auth/password/set/", { data: { password: "anything 12345" } });
    expect(res.status()).toBe(404);
  } finally {
    await user.remove();
  }
});

test("forgot-password answers the same for an address with no account", async ({ request }) => {
  const unknown = await request.post("/api/auth/recover/", {
    // Its own network, so the shared per-IP budget the other auth tests spend
    // over a full run cannot push this success case into a 429 (it asserts the
    // route treats an unknown address the same as a known one, not the limit).
    headers: { "x-forwarded-for": "198.51.100.173" },
    data: { email: `nobody-${Date.now()}@example.com` },
  });
  expect(unknown.status()).toBe(200);
  expect(await unknown.json()).toEqual({ ok: true });
});
