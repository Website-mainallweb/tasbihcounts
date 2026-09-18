import { defineConfig, devices } from "@playwright/test";

/**
 * These run against the PRODUCTION build, never `next dev`. Every failure this
 * suite is meant to catch — bundle weight, hydration, CSP under the real
 * headers from next.config.mjs, prerendered output — behaves differently in dev,
 * so a green dev run would prove nothing about what users get.
 *
 * Three viewports because the product requires three distinct layouts. The
 * breakpoint edges (374/375/376 and so on) are exercised inside the responsive
 * spec rather than as separate projects, which keeps the run cheap.
 */
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",

  /*
   * More than the 30s default. Several tests wait for networkidle, which on
   * these pages means waiting out the AdSense and analytics tags — real
   * third-party requests over a real network. With three projects running in
   * parallel that occasionally crossed 30s and failed as a timeout rather than
   * as anything about the site.
   */
  timeout: 60_000,

  /*
   * Two, on a four-core machine running three browser projects.
   *
   * Four workers meant four browsers plus the Next server on four cores, and the
   * suite went flaky in a way that moved around: a different test failed on each
   * run, always on timing — an election that had not settled, a resize that had
   * not applied. That is saturation, not a bug in the thing being tested, and
   * chasing it test by test only hides it.
   */
  workers: 2,

  use: {
    baseURL: BASE,
    trace: "on-first-retry",
    // The offline worker (public/sw.js) would answer requests the specs route
    // themselves. It does not register on 127.0.0.1 anyway; this makes it certain.
    serviceWorkers: "block",
  },

  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"] } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    // Build then serve. Slow on a cold cache and that is the point: this is the
    // artefact that ships.
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 5 * 60 * 1000,
    stdout: "pipe",
    stderr: "pipe",
    // Drops upgrade-insecure-requests from the CSP; see next.config.mjs for why
    // WebKit cannot load a single script without it.
    env: { ...process.env, NJC_E2E: "1" },
  },
});
