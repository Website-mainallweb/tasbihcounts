import { beforeEach, describe, expect, it } from "vitest";

import { GRANT_MS, holdsGrant, issueGrant, resetGrants, spendGrant } from "@/lib/reset-grant";

describe("reset grant", () => {
  beforeEach(() => resetGrants());

  it("belongs to the user it was issued for, and nobody else", () => {
    const id = issueGrant("user-a", 1_000);
    expect(holdsGrant(id, "user-a", 2_000)).toBe(true);
    expect(holdsGrant(id, "user-b", 2_000)).toBe(false);
  });

  it("is unknown when missing or made up", () => {
    expect(holdsGrant(undefined, "user-a")).toBe(false);
    expect(holdsGrant("made-up", "user-a")).toBe(false);
  });

  it("expires 15 minutes after the token was used, however often it is checked", () => {
    const id = issueGrant("user-a", 0);
    expect(holdsGrant(id, "user-a", GRANT_MS - 1)).toBe(true);
    expect(holdsGrant(id, "user-a", GRANT_MS)).toBe(false);
    expect(holdsGrant(id, "user-a", 1)).toBe(false); // gone, not revived
  });

  it("is spent once used", () => {
    const id = issueGrant("user-a");
    spendGrant(id);
    expect(holdsGrant(id, "user-a")).toBe(false);
  });

  it("is random and long enough not to guess", () => {
    const a = issueGrant("u");
    const b = issueGrant("u");
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});
