import { z } from "zod";

import { isSameSite, signInLinkOrigin } from "@/lib/payments/origin";
import { currentMode, razorpayApi } from "@/lib/payments/razorpay";
import { reconcile } from "@/lib/payments/reconcile";
import { supabasePurchaseStore } from "@/lib/payments/store";

/**
 * Where a purchase has got to, for the page that is waiting on it.
 *
 * Each call also runs reconcile(), so a payment whose webhook is late — or never
 * arrives, as on a local build — still completes while the buyer watches. That is
 * safe to expose: reconcile() is idempotent and believes only Razorpay's API.
 *
 * Returns the state and nothing else: no email, no user id, no amounts. Order
 * ids are unguessable. No user, since the buyer has no account yet; listed in
 * scripts/check-auth-handlers.mjs.
 */

const Body = z.object({ orderId: z.string().regex(/^order_[A-Za-z0-9]{6,40}$/) });

export async function POST(request: Request) {
  if (!isSameSite(request)) return Response.json({ error: "forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const outcome = await reconcile(parsed.data.orderId, {
    store: supabasePurchaseStore(),
    razorpay: razorpayApi,
    mode: currentMode(),
    origin: signInLinkOrigin(request),
  });
  return Response.json(outcome);
}
