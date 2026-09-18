import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay's two signatures (docs/SECURITY.md §4).
 *
 * Both are HMAC-SHA256, hex encoded, and both are compared in constant time: a
 * plain `===` stops at the first differing character and leaks the signature to
 * anyone patient enough to time it.
 */

export function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

/** Constant-time comparison of two hex strings. Anything malformed is false. */
export function sameHex(given: string, expected: string): boolean {
  if (!/^[0-9a-f]+$/.test(given) || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

/**
 * A webhook delivery. The signature covers the raw bytes of the body, so this
 * must be given the body exactly as received — `await request.text()`, never a
 * parsed and re-serialised object, which changes the bytes.
 */
export function isValidWebhook(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  return sameHex(signature, hmacHex(secret, rawBody));
}

/**
 * The success callback from Checkout in the browser. A valid one proves Razorpay
 * issued this payment id for this order. It grants nothing on its own: the
 * payment is still fetched from Razorpay and checked before anything is granted.
 */
export function isValidCheckout(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): boolean {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  return sameHex(signature, hmacHex(keySecret, `${orderId}|${paymentId}`));
}
