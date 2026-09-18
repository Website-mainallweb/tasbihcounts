import "server-only";

import { razorpayEnv } from "@/lib/env.server";

import type { RazorpayApi, RzPayment } from "./reconcile";
import { isValidCheckout, isValidWebhook } from "./signatures";

/**
 * Razorpay's REST API, the few calls this site makes. No SDK: four endpoints do
 * not justify a dependency that touches money.
 *
 * Every call has a timeout. A hung request inside a webhook would hold the
 * delivery open until Razorpay gives up and retries, and the retry would find
 * the same hang.
 *
 * This is the only module that reads Razorpay's secrets. Routes ask it to check a
 * signature; they never hold a secret themselves.
 */

const API = "https://api.razorpay.com/v1";

export class RazorpayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Razorpay request failed (${status} ${code})`);
    this.name = "RazorpayError";
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { keyId, keySecret } = razorpayEnv();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string } } & T;
  if (!res.ok) throw new RazorpayError(res.status, json.error?.code ?? "unknown");
  return json;
}

export type RzOrder = { id: string; amount: number; currency: string; status: string };

export function createOrder(input: {
  amount: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RzOrder> {
  return call<RzOrder>("POST", "/orders", input);
}

/** The API the reconciler needs, bound to the configured keys. */
export const razorpayApi: RazorpayApi = {
  async orderPayments(orderId) {
    const res = await call<{ items: RzPayment[] }>("GET", `/orders/${encodeURIComponent(orderId)}/payments`);
    return res.items ?? [];
  },
  payment(paymentId) {
    return call<RzPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
  },
  capture(paymentId, amount, currency) {
    return call<RzPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency });
  },
};

/**
 * Which mode the site is taking money in, from the key it was given. A purchase
 * row records the mode it was made in, and the reconciler refuses to act on a
 * row from the other one (ARCHITECTURE M6).
 */
export function currentMode(): "test" | "live" {
  return razorpayEnv().keyId.startsWith("rzp_live_") ? "live" : "test";
}

/** The key id Checkout needs in the browser. Public by design. */
export function checkoutKeyId(): string {
  return razorpayEnv().keyId;
}

/** A Checkout success callback, checked with the key secret. */
export function isValidCheckoutFor(orderId: string, paymentId: string, signature: string): boolean {
  return isValidCheckout(orderId, paymentId, signature, razorpayEnv().keySecret);
}

/** A webhook delivery, checked with the webhook secret over the raw body. */
export function isValidWebhookFor(rawBody: string, signature: string | null): boolean {
  return isValidWebhook(rawBody, signature, razorpayEnv().webhookSecret);
}
