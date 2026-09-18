import "server-only";

import { allow } from "./rate-limit";

/**
 * How hard someone may knock on the sign-in door (docs/SECURITY.md §5).
 *
 * Supabase has its own limits, but they are shared across the project and say
 * nothing about one address being guessed at. This adds what a password login
 * needs: a ceiling per address and per network, and a lock that grows teeth
 * after repeated failures. It is in memory, like the sync limiter — enough for
 * one Node process, and it errs towards letting a real person through after a
 * restart.
 *
 * Nothing here is told to the caller: every refusal outside the limiter answers
 * the same way, so none of it can be used to learn whether an account exists.
 */

const WINDOW_MS = 10 * 60_000;
/** Attempts from one address, and from one network, inside that window. */
const PER_EMAIL = 6;
const PER_IP = 15;
/** Failures before the door is held shut, and for how long. */
const EMAIL_LOCK_AFTER = 5;
const EMAIL_LOCK_MS = 15 * 60_000;
const IP_LOCK_AFTER = 25;
const IP_LOCK_MS = 60 * 60_000;

type Failures = { count: number; expires: number; lockedUntil: number };
const failures = new Map<string, Failures>();

/**
 * The caller's address behind Hostinger's proxy.
 *
 * The LAST entry of x-forwarded-for, the one our proxy appended from the TCP
 * connection. Anything before it came from the client and is free text: the
 * first entry used to be trusted, and a different made-up address on every
 * request got a fresh per-network budget each time (B04, proven 18/18
 * unthrottled).
 */
export function clientIp(request: Request): string {
  const forwarded = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return forwarded[forwarded.length - 1] || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function locked(key: string, now: number): boolean {
  const f = failures.get(key);
  if (!f) return false;
  if (f.lockedUntil <= now && f.expires <= now) {
    failures.delete(key);
    return false;
  }
  return f.lockedUntil > now;
}

/** True when this attempt must be refused before any password is checked. */
export function tooManyAttempts(ip: string, email: string, now = Date.now()): boolean {
  if (locked(`e:${email}`, now) || locked(`i:${ip}`, now)) return true;
  const emailOk = allow(`auth:e:${email}`, PER_EMAIL, WINDOW_MS, now);
  const ipOk = allow(`auth:i:${ip}`, PER_IP, WINDOW_MS, now);
  return !emailOk || !ipOk;
}

function note(key: string, after: number, lockMs: number, now: number) {
  const f = failures.get(key);
  const fresh = !f || f.expires <= now;              // the counting window has passed
  const count = (fresh ? 0 : f!.count) + 1;
  failures.set(key, {
    count,
    expires: now + WINDOW_MS,
    lockedUntil: count >= after ? now + lockMs : fresh ? 0 : f!.lockedUntil,
  });
}

/** A wrong password, a wrong code: remembered, and eventually a lock. */
export function noteFailure(ip: string, email: string, now = Date.now()): void {
  note(`e:${email}`, EMAIL_LOCK_AFTER, EMAIL_LOCK_MS, now);
  note(`i:${ip}`, IP_LOCK_AFTER, IP_LOCK_MS, now);
}

/** A real sign-in clears the address's record; the network keeps its own count. */
export function noteSuccess(_ip: string, email: string): void {
  failures.delete(`e:${email}`);
}

/** True once an address or a network is shut out, for the tests. */
export function isLocked(key: string, now = Date.now()): boolean {
  return locked(key, now);
}

/** Test seam. */
export function resetAuthThrottle(): void {
  failures.clear();
}
