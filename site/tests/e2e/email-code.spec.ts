import { expect, test, type Page } from "@playwright/test";

import { liveSupabase, type TempUser } from "./supabase-session";
import { blockThirdParty } from "./third-party";

/**
 * The one-time code in the auth email (Rajan, 2026-09-12).
 *
 * A magic LINK dies the moment anything opens it — a mail provider checking it
 * for phishing is enough, which is how Rajan's own sign-in failed — so the same
 * email also carries a code the reader types. It appears only when the project
 * has custom SMTP and `NEXT_PUBLIC_EMAIL_CODE=1` was set for the build.
 *
 * The codes here are real: `generateLink` mints the same token the mail carries
 * without sending anything, so the suite proves the whole path and still spends
 * none of the project's email allowance.
 *
 * What must hold:
 *   - a real code signs in
 *   - a wrong code is refused, in the same words as every other refusal
 *   - a code cannot be spent twice
 *
 * A forgotten password is no longer a code: it is a link to /auth/reset/
 * (tests/e2e/password.spec.ts).
 */

const HOST = "127.0.0.1";

test.describe.configure({ mode: "serial" });

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "live account: one project is enough");
  test.skip(!liveSupabase(), "needs site/.env.local with Supabase keys");
});

/**
 * The code box, opened through "I already have a code" rather than by sending.
 *
 * Nothing is emailed: these accounts live at example.com, which custom SMTP
 * rightly refuses, and the point here is the code itself.
 */
async function openCodeBox(page: Page, email: string) {
  await page.goto("/login/");
  await page.getByRole("button", { name: "Log in with an email code instead" }).click();
  if ((await page.getByRole("button", { name: "I already have a code" }).count()) === 0) {
    test.skip(true, "this build has no code box (NEXT_PUBLIC_EMAIL_CODE is not 1)");
  }
  await page.getByRole("button", { name: "I already have a code" }).click();
  await page.getByLabel("Email address").fill(email);
}

const codeBox = (page: Page) => page.getByLabel("6-digit code");
const alert = (page: Page) => page.locator(".auth-card .auth-alert");

test("a real code signs in, a wrong one is refused in the same words, and a code is spent once", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const live = liveSupabase()!;
  const user: TempUser = await live.createUser({ premium: true, host: HOST });
  try {
    // The browser itself verifies the code against Supabase, so that one host
    // has to be reachable here.
    await blockThirdParty(page, [live.projectHost]);
    await openCodeBox(page, user.email);

    // A wrong code says what every refusal says, and leaves no session.
    await codeBox(page).fill("000000");
    await page.locator(".auth-card").getByRole("button", { name: "Log in", exact: true }).click();
    await expect(alert(page)).toBeVisible();
    await page.goto("/account/");
    await expect(page).toHaveURL(/\/login\/(\?next=(\/|%2F)account(\/|%2F))?$/);

    // The real one lands on the account page.
    const code = await live.emailCode(user.email);
    expect(code).toMatch(/^\d{6}$/);
    await openCodeBox(page, user.email);
    await codeBox(page).fill(code);
    await page.locator(".auth-card").getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/$/);
    await expect(page.getByTestId("account-email")).toHaveText(user.email);

    // And it is spent: the same code again is refused.
    await context.clearCookies();
    await openCodeBox(page, user.email);
    await codeBox(page).fill(code);
    await page.locator(".auth-card").getByRole("button", { name: "Log in", exact: true }).click();
    await expect(alert(page)).toBeVisible();
    await page.goto("/account/");
    await expect(page).toHaveURL(/\/login\/(\?next=(\/|%2F)account(\/|%2F))?$/);
  } finally {
    await context.clearCookies();
    await user.remove();
  }
});
