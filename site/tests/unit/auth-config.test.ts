import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { isLoginError, loginErrorFrom, safeNext } from "../../src/lib/auth-redirect";

/**
 * Sign-in can never create an account (ARCHITECTURE §6, Phase 8). Signups are
 * off in Supabase — scripts/verify-auth-remote.mjs checks that against the live
 * project — and the code refuses too, so a console click that reopens signups
 * still cannot mint a user from this site.
 */

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

function sources(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(t|j)sx?$/.test(e.name) ? [{ path: full, text: readFileSync(full, "utf8") }] : [];
  });
}

describe("no code path can create an account", () => {
  const files = sources(SRC);

  test("every signInWithOtp call says shouldCreateUser: false", () => {
    const calls = files.flatMap(({ path, text }) =>
      [...text.matchAll(/signInWithOtp\s*\(/g)].map((m) => ({
        path,
        // The argument object that follows the call, up to its closing paren.
        args: text.slice(m.index!, text.indexOf(");", m.index!) + 2),
      })),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.args, call.path).toMatch(/shouldCreateUser:\s*false/);
  });

  test("nothing calls signUp or admin.createUser outside the payment webhook", () => {
    const offenders = files
      .filter(({ text }) => /\.auth\.signUp\s*\(|\.admin\.createUser\s*\(/.test(text))
      .map(({ path }) => path.replace(/\\/g, "/"))
      .filter((path) => !path.endsWith("/api/razorpay/webhook/route.ts") && !path.includes("/lib/payments/"));
    expect(offenders).toEqual([]);
  });
});

describe("safeNext keeps redirects on this site", () => {
  test.each([
    ["/account/", "/account/"],
    ["/stats/", "/stats/"],
    [null, "/account/"],
    ["", "/account/"],
    ["https://evil.example/", "/account/"],
    ["//evil.example/", "/account/"],
    ["/\\evil.example", "/account/"],
    ["/%2F%2Fevil.example", "/account/"],
    ["javascript:alert(1)", "/account/"],
    ["/account/?next=//evil", "/account/"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe("Supabase errors become something a buyer can act on", () => {
  test.each([
    ["Signups not allowed for this instance", null, "no_account"],
    ["Signups not allowed for otp", null, "no_account"],
    ["", "signup_disabled", "no_account"],
    ["email rate limit exceeded", null, "rate_limited"],
    ["", "over_email_send_rate_limit", "rate_limited"],
    ["Email link is invalid or has expired", null, "link_expired"],
    ["invalid flow state, no valid flow state found", null, "link_expired"],
    ["", "bad_code_verifier", "link_expired"],
    ["Something unexpected", null, "failed"],
    [null, null, "failed"],
  ])("%s / %s -> %s", (message, code, expected) => {
    expect(loginErrorFrom(message, code)).toBe(expected);
  });

  test("only known error names are accepted from the URL", () => {
    expect(isLoginError("no_account")).toBe(true);
    expect(isLoginError("<script>")).toBe(false);
    expect(isLoginError(null)).toBe(false);
  });
});
