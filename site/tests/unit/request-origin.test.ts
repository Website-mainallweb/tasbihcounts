import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Where a link we email somebody points (lib/request-origin.ts).
 *
 * The bug this exists to stop: a password-reset sent from a local run arriving
 * with a link to the live site, where the one-time token gets spent. Nobody
 * notices until the person says "the link didn't work".
 */

const head = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => head.get(k.toLowerCase()) ?? null }),
}));

vi.mock("@/lib/site", () => ({ SITE_URL: "https://bhaktinamjap.com" }));

const { siteOrigin } = await import("@/lib/request-origin");

function arrivingAt(host: string | null, proto?: string) {
  head.clear();
  if (host) head.set("host", host);
  if (proto) head.set("x-forwarded-proto", proto);
}

beforeEach(() => head.clear());

describe("in production", () => {
  test("uses the domain the request came in on", async () => {
    arrivingAt("bhaktinamjap.com", "https");
    expect(await siteOrigin()).toBe("https://bhaktinamjap.com");
  });

  test("follows a domain change without anything being edited", async () => {
    // The whole point: no constant to update when the site moves.
    arrivingAt("bhaktinamjap.com", "https");
    expect(await siteOrigin()).toBe("https://bhaktinamjap.com");
  });

  test("keeps www when that is how the visitor arrived", async () => {
    arrivingAt("www.bhaktinamjap.com", "https");
    expect(await siteOrigin()).toBe("https://www.bhaktinamjap.com");
  });

  test("sends a buyer to the site, not to the admin subdomain", async () => {
    // The action runs on admin.<domain>, but the person receiving the mail signs
    // in on the site. The label has to come off.
    arrivingAt("admin.bhaktinamjap.com", "https");
    expect(await siteOrigin()).toBe("https://bhaktinamjap.com");
  });
});

describe("in development", () => {
  test("stays local, so a test link never reaches the live site", async () => {
    arrivingAt("localhost:3000");
    expect(await siteOrigin()).toBe("http://localhost:3000");
  });

  test("stays local on the admin host too, with the label removed", async () => {
    // The panel runs on admin.localhost while testing. A reset sent from there
    // must reach localhost — it used to fall back to the live domain, which is
    // this module's whole reason for existing, one subdomain to the left.
    arrivingAt("admin.localhost:3105");
    expect(await siteOrigin()).toBe("http://localhost:3105");
  });

  test("uses http for 127.0.0.1 without a proxy header", async () => {
    arrivingAt("127.0.0.1:3100");
    expect(await siteOrigin()).toBe("http://127.0.0.1:3100");
  });
});

describe("when the host cannot be trusted", () => {
  test("falls back for a host that is not ours", async () => {
    // A forged Host header must not become the destination of a reset email.
    arrivingAt("evil.example.com", "https");
    expect(await siteOrigin()).toBe("https://bhaktinamjap.com");
  });

  test("falls back for a look-alike domain", async () => {
    arrivingAt("bhaktinamjap.com.evil.example", "https");
    expect(await siteOrigin()).toBe("https://bhaktinamjap.com");
  });

  test("falls back when there is no host at all", async () => {
    arrivingAt(null);
    expect(await siteOrigin()).toBe("https://bhaktinamjap.com");
  });

  test("falls back on a host that is not a host", async () => {
    arrivingAt("not a host");
    expect(await siteOrigin()).toBe("https://bhaktinamjap.com");
  });
});
