/**
 * The secret scanner is a control, and an untested control is a decoration.
 * These cases are the real credential shapes this project handles, written so
 * that weakening a pattern breaks a test rather than going unnoticed.
 *
 * The literals below are deliberately invalid — right shape, wrong bytes — so
 * this file is safe to commit while still exercising the patterns.
 */
import { describe, expect, it } from "vitest";

import { RULES, scanLine } from "../../scripts/secret-rules.mjs";

const ids = (line: string): string[] =>
  scanLine(line).map((h: { id: string }) => h.id);

describe("scanLine catches", () => {
  it("a secret renamed into the public namespace", () => {
    expect(ids('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY = "x"')).toContain( // check-secrets:allow fake fixture for the scanner test
      "public-secret-name",
    );
    expect(ids("NEXT_PUBLIC_RAZORPAY_WEBHOOK_SECRET=abc")).toContain( // check-secrets:allow fake fixture for the scanner test
      "public-secret-name",
    );
  });

  it("a Supabase personal access token", () => {
    expect(ids(`const t = "sbp_${"a".repeat(40)}"`)).toContain(
      "supabase-access-token",
    );
  });

  it("a Google OAuth client secret", () => {
    expect(ids('secret: "GOCSPX-0123456789abcdefghijk"')).toContain( // check-secrets:allow fake fixture for the scanner test
      "google-oauth-secret",
    );
  });

  it("a Razorpay live key", () => {
    expect(ids('key_id: "rzp_live_0123456789ab"')).toContain("razorpay-live-key"); // check-secrets:allow fake fixture for the scanner test
  });

  it("a private key block", () => {
    expect(ids("-----BEGIN PRIVATE KEY-----")).toContain("private-key-block"); // check-secrets:allow fake fixture for the scanner test
    expect(ids("-----BEGIN RSA PRIVATE KEY-----")).toContain("private-key-block"); // check-secrets:allow fake fixture for the scanner test
  });

  it("a hard-coded JWT, whatever its role", () => {
    const jwt = `eyJ${"a".repeat(20)}.eyJ${"b".repeat(60)}.${"c".repeat(30)}`;
    expect(ids(`const anon = "${jwt}"`)).toContain("jwt-literal");
  });
});

describe("scanLine leaves alone", () => {
  it("ordinary public config", () => {
    expect(ids("NEXT_PUBLIC_SITE_URL=https://bhaktinamjap.com")).toEqual([]);
    expect(ids("NEXT_PUBLIC_FIREBASE_PROJECT_ID=bhakti-nam-jap")).toEqual([]);
  });

  it("the names of secrets, when they are only names", () => {
    expect(ids("RAZORPAY_WEBHOOK_SECRET=")).toEqual([]);
    expect(ids("// read SUPABASE_SERVICE_ROLE_KEY from the server env")).toEqual([]);
  });

  it("prose that happens to contain the word secret", () => {
    expect(ids("The webhook secret is set in the dashboard.")).toEqual([]);
  });

  it("a line that opts out and says why", () => {
    expect(
      ids(`const t = "sbp_${"a".repeat(40)}" // check-secrets:allow test fixture`),
    ).toEqual([]);
  });
});

describe("the rule set itself", () => {
  it("has unique ids and a reason for every rule", () => {
    const seen = new Set<string>();
    for (const rule of RULES as { id: string; why: string }[]) {
      expect(rule.why, `${rule.id} needs a reason`).toBeTruthy();
      expect(seen.has(rule.id), `duplicate id ${rule.id}`).toBe(false);
      seen.add(rule.id);
    }
  });

  it("does not match its own source, or this test would be unrunnable", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../scripts/secret-rules.mjs", import.meta.url),
      "utf8",
    );
    for (const line of src.split("\n")) expect(ids(line)).toEqual([]);
  });
});
