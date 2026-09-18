import "server-only";

import { randomBytes } from "node:crypto";

/**
 * Proof that this browser verified a password-reset token a moment ago.
 *
 * The reset route spends the token before it can know the account's address,
 * so a password refused for containing that address arrives after the token is
 * gone. The person should be able to pick another without a new email — but a
 * plain signed-in session is not proof of a reset (Supabase marks a reset
 * session `amr: otp`, the same as a sign-in code, probed 2026-09-13), and must
 * never let a browser change the password without the current one.
 *
 * So a verified token leaves a random grant: kept here in memory and in an
 * httpOnly cookie. It names the user, lasts 15 minutes from the token's use (a
 * retry does not extend it) and is spent by the password it finally sets. A
 * restart forgets it, which only means asking for a fresh link.
 */

export const GRANT_COOKIE = "njc_reset";
export const GRANT_MS = 15 * 60_000;

const grants = new Map<string, { userId: string; expires: number }>();

export function issueGrant(userId: string, now = Date.now()): string {
  for (const [k, g] of grants) if (g.expires <= now) grants.delete(k);
  const id = randomBytes(24).toString("base64url");
  grants.set(id, { userId, expires: now + GRANT_MS });
  return id;
}

/** Whether the grant exists, is fresh and belongs to this user. Does not spend it. */
export function holdsGrant(id: string | undefined, userId: string, now = Date.now()): boolean {
  const g = id ? grants.get(id) : undefined;
  if (!g) return false;
  if (g.expires <= now) {
    grants.delete(id!);
    return false;
  }
  return g.userId === userId;
}

export function spendGrant(id: string | undefined): void {
  if (id) grants.delete(id);
}

/** Test seam. */
export function resetGrants(): void {
  grants.clear();
}
