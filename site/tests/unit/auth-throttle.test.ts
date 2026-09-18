import { beforeEach, describe, expect, it } from "vitest";

import {
  clientIp,
  noteFailure,
  noteSuccess,
  resetAuthThrottle,
  tooManyAttempts,
} from "../../src/lib/auth-throttle";
import { resetRateLimits } from "../../src/lib/rate-limit";

/**
 * The door to a password sign-in. Guessing must get slow, a real person must
 * not, and nothing here may tell the caller which addresses exist — that is the
 * route's job, and it answers the same way for every refusal.
 */

const IP = "203.0.113.7";
const EMAIL = "buyer@example.com";

beforeEach(() => {
  resetAuthThrottle();
  resetRateLimits();
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("https://example.com/", { headers });

  it("takes the last entry of x-forwarded-for, the one our proxy added", () => {
    expect(clientIp(req({ "x-forwarded-for": "10.9.9.9, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("B04: a made-up leading entry does not change the bucket", () => {
    const a = clientIp(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }));
    const b = clientIp(req({ "x-forwarded-for": "8.8.8.8, 203.0.113.7" }));
    expect(a).toBe(b);
  });

  it("B03: asking for mail does not use the password log-in budget of that address", () => {
    for (let i = 0; i < 7; i++) tooManyAttempts(`198.18.0.${i}`, `mail:${EMAIL}`);
    expect(tooManyAttempts("198.19.0.1", EMAIL)).toBe(false);
  });

  it("falls back to x-real-ip, then to a single bucket", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(req({}))).toBe("unknown");
  });
});

describe("attempts", () => {
  it("lets a real person try a few times", () => {
    for (let i = 0; i < 6; i++) expect(tooManyAttempts(IP, EMAIL)).toBe(false);
  });

  it("refuses once one address has been tried too often", () => {
    for (let i = 0; i < 6; i++) tooManyAttempts(IP, EMAIL);
    expect(tooManyAttempts(IP, EMAIL)).toBe(true);
  });

  it("does not punish a different address on the same network straight away", () => {
    for (let i = 0; i < 6; i++) tooManyAttempts(IP, EMAIL);
    expect(tooManyAttempts(IP, "someone-else@example.com")).toBe(false);
  });

  it("stops a network working through many addresses", () => {
    for (let i = 0; i < 16; i++) tooManyAttempts(IP, `person${i}@example.com`);
    expect(tooManyAttempts(IP, "fresh@example.com")).toBe(true);
  });

  it("counts each network on its own", () => {
    for (let i = 0; i < 16; i++) tooManyAttempts(IP, `person${i}@example.com`);
    expect(tooManyAttempts("198.51.100.9", "fresh@example.com")).toBe(false);
  });
});

describe("failures", () => {
  it("holds the door shut after five wrong passwords, past the attempt window", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) noteFailure(IP, EMAIL, now);
    // Eleven minutes later the attempt counters have rolled over; the lock has not.
    expect(tooManyAttempts(IP, EMAIL, now + 11 * 60_000)).toBe(true);
  });

  it("opens again once the lock has run out", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) noteFailure(IP, EMAIL, now);
    expect(tooManyAttempts(IP, EMAIL, now + 16 * 60_000)).toBe(false);
  });

  it("does not lock on a single slip", () => {
    const now = Date.now();
    noteFailure(IP, EMAIL, now);
    expect(tooManyAttempts(IP, EMAIL, now + 1000)).toBe(false);
  });

  it("forgets an address as soon as it signs in", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) noteFailure(IP, EMAIL, now);
    noteSuccess(IP, EMAIL);
    resetRateLimits(); // the same person, a minute later, with the right password
    expect(tooManyAttempts(IP, EMAIL, now + 60_000)).toBe(false);
  });

  it("locks a network that has failed from many addresses", () => {
    const now = Date.now();
    for (let i = 0; i < 25; i++) noteFailure(IP, `person${i}@example.com`, now);
    resetRateLimits();
    expect(tooManyAttempts(IP, "anyone@example.com", now + 11 * 60_000)).toBe(true);
  });
});
