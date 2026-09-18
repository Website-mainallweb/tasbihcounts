import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The scheduler's credential: `Authorization: Bearer <CRON_SECRET>`.
 *
 * Both sides are hashed first, so the comparison is constant-time even when the
 * lengths differ — timingSafeEqual throws on unequal lengths, and an early
 * length check would itself leak the secret's length.
 */
export function isValidCronAuth(header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  const given = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
