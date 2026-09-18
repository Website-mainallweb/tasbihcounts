import { expect, test, type Page } from "@playwright/test";

import { blockThirdParty, watchForProductionRequests } from "./third-party";

/**
 * Restore takes a file from anywhere, so it is tested with the files a careless
 * or hostile person might hand it. None of them may run anything, freeze the
 * tab, or change the practice without the user agreeing to what it adds.
 * src/lib/counter/backup.ts holds the rules; this is the wiring in a browser.
 */

const hot = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("njc.hot") || "null"));
const cold = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("njc.cold") || "null"));

async function openCounter(page: Page) {
  await blockThirdParty(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!localStorage.getItem("njc.hot"));
}

/** Space is a tap; spaced past the counter's 40ms de-bounce. */
async function tap(page: Page, times: number) {
  await expect(page.getByRole("button", { name: /^Count .*Currently/ })).toBeVisible();
  for (let i = 0; i < times; i++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(45);
  }
}

async function restore(page: Page, name: string, contents: string | Buffer) {
  await page.locator("#njcFile").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: typeof contents === "string" ? Buffer.from(contents, "utf8") : contents,
  });
}

const notice = (page: Page) => page.locator("[data-ledger-notice]");

async function counterWithTaps(page: Page, taps: number) {
  await openCounter(page);
  await tap(page, taps);
  await expect.poll(async () => (await hot(page)).rec.c).toBe(taps);
}

/* No test may touch the live site: it is under AdSense review. */
let assertNoProductionTraffic: (() => void) | undefined;

test.beforeEach(({ page }) => {
  assertNoProductionTraffic = watchForProductionRequests(page);
});

test.afterEach(() => {
  assertNoProductionTraffic?.();
  assertNoProductionTraffic = undefined;
});

test("text that is not a backup is refused, runs nothing, and changes nothing", async ({ page }) => {
  await counterWithTaps(page, 3);
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void d.dismiss();
  });

  await restore(page, "evil.json", '<script>window.__ran = true</script>{"lifetime":');
  await expect(notice(page).locator("p")).toHaveText("That file could not be read");

  expect(await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran)).toBeUndefined();
  expect(dialogs).toBe(0);
  expect((await hot(page)).rec.c).toBe(3);
});

test("a file larger than a backup could be is refused before it is read", async ({ page }) => {
  await counterWithTaps(page, 2);
  await restore(page, "huge.json", Buffer.alloc(5_000_001, 0x20));
  await expect(notice(page).locator("p")).toHaveText("That file is too large to be a Tasbih Counts backup");
  expect((await hot(page)).fields.lifetime).toBe(2);
});

test("a hostile file is capped, and nothing is added until the user agrees", async ({ page }) => {
  await counterWithTaps(page, 4);
  const file = JSON.stringify({
    version: 2,
    backupId: "b-hostile",
    state: {
      lifetime: 1e30,
      malaDone: 1e30,
      hist: {
        "2026-01-01": { c: 1e15, r: 1e15, s: 1e15, n: { subhanallah: { c: 1e15 }, "<img src=x>": { c: 5 } } },
        "2099-01-01": { c: 777 },
      },
      custom: [{ id: '"><img src=x onerror=alert(1)>', n: "Om‮evil" }],
      favs: ["<b>", "subhanallah"],
    },
  }).replace('"state":{', '"state":{"__proto__":{"polluted":true},');

  await restore(page, "hostile.json", file);

  // Asked first, with the capped figure. The file's one day is capped at the
  // per-day maximum (1 crore), and its claimed lifetime of 10^30 is believed only
  // up to that history plus one more crore for a pre-history total — less the 4
  // already counted here.
  await expect(notice(page).locator(".act")).toHaveText("Add them");
  await expect(notice(page).locator("p")).toContainText("19,999,996 counts");

  // Declined: nothing changed.
  await notice(page).locator(".x").click();
  expect(Object.keys((await cold(page)).state.hist)).not.toContain("2026-01-01");
  expect((await hot(page)).fields.lifetime).toBe(4);

  // Accepted: only the safe, capped values go in.
  await restore(page, "hostile.json", file);
  await notice(page).locator(".act").click();
  await expect(notice(page).locator("p")).toContainText("Restored");

  const state = (await cold(page)).state;
  expect(state.hist["2026-01-01"].c).toBe(10_000_000);
  expect(state.hist["2026-01-01"].s).toBe(86_400_000);
  expect(Object.keys(state.hist["2026-01-01"].n)).toEqual(["subhanallah"]);
  expect(state.hist).not.toHaveProperty("2099-01-01");
  expect(state.custom[0].id).toMatch(/^c[A-Za-z0-9_-]+$/);
  expect(state.custom[0].n).toBe("Omevil");
  expect(state.favs).not.toContain("<b>");
  expect(state.lifetime).toBeLessThanOrEqual(10_000_004 + 10_000_000);
  expect(await page.evaluate(() => ({} as Record<string, unknown>).polluted)).toBeUndefined();

  // Nothing from the file reached the page as markup.
  expect(await page.locator(".tc img").count()).toBe(0);
});

test("a file with nothing new says so, and asks nothing", async ({ page }) => {
  await counterWithTaps(page, 1);
  await restore(page, "empty.json", JSON.stringify({ lifetime: 0 }));
  await expect(notice(page).locator("p")).toHaveText("This file has nothing new to add.");
  await expect(notice(page).locator(".act")).toHaveCount(0);
});
