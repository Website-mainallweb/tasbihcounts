import { expect, test, type Page } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * The navigation's contract (redesign, 2026-09-13): one navigation, in the
 * header. From 1024 up the destinations sit in the header row beside the logo;
 * below 1024 they are in a side drawer. Log in opens a popup, Get Premium goes to
 * the Premium page, and no destination leads nowhere.
 *
 * Sizes are set inside each test because what is checked is the switch between
 * the drawer and the header row — a fixed project viewport sees one side.
 */

const header = (page: Page) => page.locator(".site-header");
const toggle = (page: Page) => page.locator(".nav-toggle");
const more = (page: Page) => page.locator(".site-header .nav-more");
const drawer = (page: Page) => page.locator("#site-drawer");

async function at(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(120);
}

test.beforeEach(async ({ page, context }) => {
  await blockThirdParty(page);
  context.on("page", (p) => {
    void blockThirdParty(p);
  });
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

test.describe("desktop: everything is in the header", () => {
  for (const [name, width, height] of [
    ["small desktop", 1024, 768],
    ["desktop", 1440, 900],
  ] as const) {
    test(`${name}: the five destinations, Log in and Get Premium are in the header row`, async ({ page }) => {
      await page.goto("/");
      await at(page, width, height);

      await expect(toggle(page)).toBeHidden();
      for (const label of ["Counter", "Streak", "Stats", "Library", "Settings"]) {
        await expect(header(page).locator(".site-nav > a", { hasText: label })).toBeVisible();
      }
      await expect(more(page).locator("summary")).toBeVisible();
      await expect(header(page).getByRole("link", { name: "Log in" })).toBeVisible();
      await expect(header(page).getByRole("link", { name: "Get Premium" })).toBeVisible();
    });

    test(`${name}: the header row fits on one line`, async ({ page }) => {
      await page.goto("/");
      await at(page, width, height);
      const box = await header(page).locator(".header-row").boundingBox();
      expect(box!.height).toBeLessThan(90);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBeLessThanOrEqual(1);
    });
  }

  test("More holds the other pages, and closes the way a menu should", async ({ page }) => {
    await page.goto("/");
    await at(page, 1440, 900);

    const menu = more(page).locator(".nav-more-menu");
    await expect(menu).toBeHidden();

    await more(page).locator("summary").click();
    await expect(menu).toBeVisible();
    for (const label of ["About Us", "Contact Us", "Privacy Policy", "Terms of Service", "Refund Policy"]) {
      await expect(menu.getByRole("link", { name: label })).toBeVisible();
    }

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    await more(page).locator("summary").click();
    await expect(menu).toBeVisible();
    // The open menu covers the page title, so click well clear of it.
    await page.mouse.click(1420, 600);
    await expect(menu).toBeHidden();
  });

  test("marks the page you are on", async ({ page }) => {
    await page.goto("/streak/");
    await at(page, 1440, 900);
    await expect(header(page).locator('.site-nav > a[aria-current="page"]')).toHaveText("Streak");
  });

  test("marks More when the page you are on is inside it", async ({ page }) => {
    await page.goto("/about-us/");
    await at(page, 1440, 900);
    await expect(more(page).locator("summary")).toHaveAttribute("aria-current", "page");
  });
});

test.describe("phone and tablet: the drawer", () => {
  for (const [name, width, height] of [
    ["phone", 375, 812],
    ["tablet", 768, 1024],
  ] as const) {
    test(`${name}: holds both groups, the counter only once, and Log in / Get Premium`, async ({ page }) => {
      await page.goto("/about-us/");
      await at(page, width, height);

      await expect(header(page).locator(".site-nav")).toBeHidden();
      await expect(drawer(page)).toBeHidden();
      await toggle(page).click();
      await expect(drawer(page)).toBeVisible();
      await expect(drawer(page)).toContainText("Streak");
      await expect(drawer(page)).toContainText("About Us");
      // The logo in the drawer's head is a link home too; the menu itself lists the counter once.
      await expect(drawer(page).locator('.drawer-body a[href="/"]')).toHaveCount(1);
      await expect(drawer(page).getByRole("link", { name: /Get Premium/ })).toBeVisible();
      await expect(drawer(page).getByRole("link", { name: "Log in" })).toBeVisible();

      // Focus is inside, Escape closes and gives focus back to the button.
      expect(await page.evaluate(() => !!document.activeElement?.closest("#site-drawer"))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(drawer(page)).toBeHidden();
      await expect(toggle(page)).toBeFocused();

      // The scrim closes it too, and the page scrolls again.
      await toggle(page).click();
      await page.mouse.click(10, height / 2);
      /*
       * Longer than the 5s default. Closing runs a transition and then a state
       * update, and on a full run — two workers, three projects, seventeen
       * minutes — that pair has crossed five seconds. The drawer closes; the
       * default was simply measuring a busy laptop rather than the product.
       */
      await expect(drawer(page)).toBeHidden({ timeout: 15_000 });
      expect(await page.evaluate(() => document.documentElement.classList.contains("nav-open"))).toBe(false);
    });
  }

  test("a link in the drawer navigates and closes it", async ({ page }) => {
    await page.goto("/about-us/");
    await at(page, 375, 812);
    await toggle(page).click();
    await drawer(page).getByRole("link", { name: /Stats/ }).click();
    await page.waitForURL((u) => u.pathname === "/stats/");
    await expect(drawer(page)).toBeHidden();
  });
});

test.describe("the log-in popup", () => {
  for (const [name, width, height] of [
    ["phone", 375, 812],
    ["desktop", 1440, 900],
  ] as const) {
    test(`${name}: opens from the header, switches tabs, closes on Escape`, async ({ page }) => {
      await page.goto("/about-us/");
      await at(page, width, height);

      if (width < 600) {
        await toggle(page).click();
        await drawer(page).getByRole("link", { name: "Log in" }).click();
      } else {
        await header(page).getByRole("link", { name: "Log in" }).click();
      }

      const dialog = page.locator("dialog.auth-dialog");
      // The popup and its Supabase client arrive as a dynamic import on the first
      // open; under a loaded run that chunk can take longer than the default wait.
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      // Still on the page it was opened from: a popup, not a navigation.
      expect(new URL(page.url()).pathname).toBe("/about-us/");
      await expect(dialog.getByRole("heading", { name: "Welcome back" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Continue with Google" })).toBeVisible();

      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);

      await dialog.getByRole("tab", { name: "Get Premium" }).click();
      await expect(dialog.getByRole("link", { name: /Continue to Premium/ })).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });
  }

  test("typing in the popup does not count on the counter", async ({ page }) => {
    await page.goto("/");
    await at(page, 1440, 900);
    const count = page.locator("#njcDigits").first();
    const before = await count.textContent();
    await header(page).getByRole("link", { name: "Log in" }).click();
    const email = page.locator("dialog.auth-dialog input[type=email]");
    // Wait out the popup's dynamic import before reaching into it (see above).
    await expect(email).toBeVisible({ timeout: 15_000 });
    await email.click();
    await page.keyboard.type("a b c ");
    await page.keyboard.press("Enter");
    await expect(email).toHaveValue(/a b c/);
    await page.keyboard.press("Escape");
    await expect(count).toHaveText(before ?? "0");
  });

  test("/login/ still works as a page on its own", async ({ page }) => {
    const res = await page.goto("/login/");
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toContainText("Log in");
    await expect(page.locator(".auth-card").getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  });
});

test.describe("every destination leads somewhere", () => {
  for (const [path, heading] of [
    ["/streak/", "Streak"],
    ["/stats/", "Stats"],
  ] as const) {
    test(`${path} renders`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1").first()).toContainText(heading);
    });

    test(`${path} is not offered to search engines`, async ({ page }) => {
      await page.goto(path);
      const robots = await page.locator('meta[name="robots"]').getAttribute("content");
      expect(robots).toContain("noindex");
    });
  }

  test("Library in the header opens the counter's own sheet", async ({ page }) => {
    await page.goto("/");
    await at(page, 1440, 900);

    await header(page).locator('.site-nav > a[href="/#library"]').click();
    await expect(page.getByRole("dialog", { name: /choose dhikr/i })).toBeVisible();
    // The hash described an action, not a place.
    expect(new URL(page.url()).hash).toBe("");
  });

  test("Settings in the header opens the settings sheet, even from another page", async ({ page }) => {
    await page.goto("/stats/");
    await at(page, 1440, 900);

    await header(page).locator('.site-nav > a[href="/#settings"]').click();
    await page.waitForURL((u) => u.pathname === "/");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  });

  test("Library in the phone drawer opens the sheet", async ({ page }) => {
    await page.goto("/");
    await at(page, 375, 812);
    await toggle(page).click();
    await drawer(page).locator('a[href="/#library"]').click();
    await expect(drawer(page)).toBeHidden();
    await expect(page.getByRole("dialog", { name: /choose dhikr/i })).toBeVisible();
  });
});
