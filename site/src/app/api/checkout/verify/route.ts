import { z } from "zod";

import { signInLinkOrigin, isSameSite } from "@/lib/payments/origin";
import { currentMode, isValidCheckoutFor, razorpayApi } from "@/lib/payments/razorpay";
import { reconcile } from "@/lib/payments/reconcile";
import { supabasePurchaseStore } from "@/lib/payments/store";

/**
 * Checkout's success callback, sent on by the browser.
 *
 * The signature proves Razorpay issued this payment for this order, so the
 * purchase can be marked payment_verified. It still grants nothing itself:
 * reconcile() fetches the payment from Razorpay's API and checks the amount,
 * currency and mode against our own row before anything is granted.
 *
 * This is also what makes a purchase complete on a machine the webhook cannot
 * reach, such as a local build — the webhook stays the authority in production,
 * and both paths run the same idempotent reconcile.
 *
 * No user: the buyer has no account until this runs. Listed in
 * scripts/check-auth-handlers.mjs.
 */

const Body = z.object({
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]{6,40}$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function POST(request: Request) {
  if (!isSameSite(request)) return Response.json({ error: "forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } =
    parsed.data;

  if (!isValidCheckoutFor(orderId, paymentId, signature)) {
    return Response.json({ error: "bad_signature" }, { status: 400 });
  }

  const store = supabasePurchaseStore();
  await store.advance(orderId, "payment_verified");

  const outcome = await reconcile(orderId, {
    store,
    razorpay: razorpayApi,
    mode: currentMode(),
    origin: signInLinkOrigin(request),
  });
  return Response.json(outcome);
}
