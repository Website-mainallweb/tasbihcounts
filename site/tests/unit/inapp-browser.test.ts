import { describe, expect, it } from "vitest";

import { isInAppBrowser } from "../../src/components/InAppBrowserNotice";

/**
 * UX walkthrough #43. Most visitors arrive from a link shared in a chat, and
 * those built-in browsers refuse Google sign-in, usually swallow downloads, and
 * can lose their storage when the app closes.
 */
describe("isInAppBrowser", () => {
  const inApp = [
    // Facebook on iOS and Android
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/470.0]",
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0]",
    // Instagram
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 334.0.0.14.104",
    // WhatsApp
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 WhatsApp/2.24",
    // Any Android WebView
    "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
    // Google app
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 GSA/300.0",
  ];

  const realBrowsers = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36 Edg/126",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  ];

  for (const ua of inApp) {
    it(`recognises ${ua.slice(0, 48)}…`, () => expect(isInAppBrowser(ua)).toBe(true));
  }

  for (const ua of realBrowsers) {
    it(`leaves a real browser alone: ${ua.slice(0, 40)}…`, () => expect(isInAppBrowser(ua)).toBe(false));
  }

  it("says nothing when there is no user agent at all", () => {
    expect(isInAppBrowser("")).toBe(false);
  });
});
