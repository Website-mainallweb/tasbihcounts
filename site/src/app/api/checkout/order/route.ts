import { randomBytes } from "node:crypto";

import { z } from "zod";

import { flagOn } from "@/lib/flags";
import { isSameSite } from "@/lib/payments/origin";
import { CURRENT_PLAN } from "@/lib/payments/plans";
import { checkoutKeyId, createOrder, currentMode } from "@/lib/payments/razorpay";
import { supabasePurchaseStore } from "@/lib/payments/store";

/**
 * Starts a purchase: a Razorpay order, and our own row that records what was
 * ordered, for how much, in which mode, and for which email.
 *
 * Pay-first (docs/ARCHITECTURE.md §4): there is no account yet, so there is no
 * user to require. Listed in scripts/check-auth-handlers.mjs. Nothing here grants
 * anything — an order is only a price and an email until Razorpay reports the
 * money arrived.
 */

const Body = z.object({
  email: z.email().max(320),
  // The buyer agreed to the Terms and the Refund Policy before paying.
  accept: z.literal(true),
});

const MAX_ORDERS_PER_HOUR = 5;

export async function POST(request: Request) {
  if (!isSameSite(request)) return Response.json({ error: "forbidden" }, { status: 403 });

  /* The payments kill switch (docs/ADMIN.md §3.8). Checked here rather than only
     on the Premium page, because a page that has been open since before the
     switch was thrown would otherwise still start a checkout. Nobody who has
     already bought loses anything — this refuses new orders and nothing else. */
  if (!(await flagOn("payments"))) {
    return Response.json({ error: "payments_off" }, { status: 503 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();

  const store = supabasePurchaseStore();
  if ((await store.countRecentPurchases(email)) >= MAX_ORDERS_PER_HOUR) {
    return Response.json({ error: "too_many" }, { status: 429 });
  }

  const mode = currentMode();
  // A lifetime plan bought twice is money we would have to hand back, and the
  // Refund Policy refunds technical failures only. Answer before any order exists.
  // This says no more than the sign-in page already does for the same address.
  if (await store.hasActivePremium(email, mode)) {
    return Response.json({ error: "already_premium" }, { status: 409 });
  }
  const order = await createOrder({
    amount: CURRENT_PLAN.amount,
    currency: CURRENT_PLAN.currency,
    receipt: `bnj_${randomBytes(8).toString("hex")}`,
    notes: { plan_id: CURRENT_PLAN.id },
  });

  await store.createPurchase({
    orderId: order.id,
    planId: CURRENT_PLAN.id,
    amount: CURRENT_PLAN.amount,
    currency: CURRENT_PLAN.currency,
    mode,
    email,
  });

  return Response.json({
    orderId: order.id,
    keyId: checkoutKeyId(),
    amount: CURRENT_PLAN.amount,
    currency: CURRENT_PLAN.currency,
    email,
    mode,
  });
}
