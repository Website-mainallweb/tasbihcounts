import { describe, expect, it } from "vitest";

import { PASSWORD_MESSAGES, passwordProblem } from "@/lib/password-rules";

describe("passwordProblem", () => {
  it("accepts a long phrase with a letter and a number", () => {
    expect(passwordProblem("ram naam 108 times")).toBeNull();
  });

  it("refuses short, letter-only, digit-only and over-long passwords", () => {
    expect(passwordProblem("abc123")).toBe("short");
    expect(passwordProblem("onlyletters")).toBe("plain");
    expect(passwordProblem("12345678901")).toBe("plain");
    expect(passwordProblem("a1".repeat(101))).toBe("long");
  });

  it("refuses a password that contains the address's own name", () => {
    expect(passwordProblem("devotee2026abc", "devotee@example.com")).toBe("has_email");
    expect(passwordProblem("Devotee2026abc", "DEVOTEE@example.com")).toBe("has_email");
    // Too short a local part to judge by
    expect(passwordProblem("ab2026xyzqq", "ab@example.com")).toBeNull();
  });

  it("has a message for every answer the reset route can give", () => {
    for (const code of ["short", "long", "plain", "has_email", "mismatch", "same", "link_expired", "rate_limited", "leaked", "failed"]) {
      expect(PASSWORD_MESSAGES[code as keyof typeof PASSWORD_MESSAGES]).toBeTruthy();
    }
  });
});
