"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { audit } from "@/lib/admin/audit";
import { getPurchase, grantEntitlement } from "@/lib/admin/db";
import { currentMode, razorpayApi } from "@/lib/payments/razorpay";
import { reconcile } from "@/lib/payments/reconcile";
import { supabasePurchaseStore } from "@/lib/payments/store";
import { siteOrigin } from "@/lib/request-origin";

/**
 * The two things support does to a purchase (docs/ADMIN.md §3.4, §3.6).
 */

const orderShape = z.string().regex(/^order_[A-Za-z0-9]{6,40}$/);
const PLAN = "premium_lifetime_v1";

function back(orderId: string, message: string): never {
  redirect(`/admin/payments/${orderId}/?m=${encodeURIComponent(message)}`);
}

/**
 * Re-run a stuck purchase.
 *
 * It runs the same reconcile() the checkout and the webhook use: read the
 * payment from Razorpay, check amount, currency and mode against our own row,
 * and carry the purchase forward from wherever it stopped.
 *
 * Support cannot grant Premium that was not paid for through this button,
 * because this button cannot grant anything — it only asks Razorpay again and
 * lets the tested code decide. That is also why it calls reconcile() rather than
 * writing an entitlement: one path to Premium, and it is the one with the money
 * checks in it.
 */
export async function rerun(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderId = orderShape.parse(formData.get("orderId"));

  const before = await getPurchase(orderId);
  if (!before) back(orderId, "No such purchase.");

  const outcome = await reconcile(orderId, {
    store: supabasePurchaseStore(),
    razorpay: razorpayApi,
    mode: currentMode(),
    // reconcile() may send the buyer their "Premium is ready" sign-in link, so
    // this has to be the host we are actually running on (lib/request-origin.ts).
    origin: await siteOrigin(),
  });

  const after = await getPurchase(orderId);

  await audit(admin, {
    action: "purchase.rerun",
    subject: orderId,
    before: { state: before.purchase.state },
    after: { state: after?.purchase.state ?? "gone", outcome: JSON.stringify(outcome) },
  });

  revalidatePath(`/admin/payments/${orderId}`);
  back(
    orderId,
    before.purchase.state === after?.purchase.state
      ? `Nothing changed — still ${after?.purchase.state.replace(/_/g, " ")}.`
      : `Now ${after?.purchase.state.replace(/_/g, " ")}.`,
  );
}

/**
 * Restore a purchase onto the account that is actually signed in.
 *
 * The single most likely support ticket this product will get: paid with one
 * email, signed in with another. The payment is real and already verified — what
 * is missing is the link between it and an account.
 *
 * This does grant Premium directly, which is why it takes an account id typed in
 * by hand, requires a reason, and writes both plus the order into the log. The
 * check it does make is the one that matters: there must be a captured payment
 * against this order. An order nobody paid for restores nothing.
 */
export async function restoreTo(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderId = orderShape.parse(formData.get("orderId"));

  const target = z.string().uuid().safeParse(String(formData.get("userId") ?? "").trim());
  if (!target.success) back(orderId, "That is not an account id. Copy it from the user's page.");

  const reason = z.string().trim().min(4).max(500).safeParse(formData.get("reason"));
  if (!reason.success) back(orderId, "A reason is required to restore a purchase.");

  const record = await getPurchase(orderId);
  if (!record) back(orderId, "No such purchase.");

  const captured = record.payments.some((p) => p.status === "captured");
  if (!captured) {
    back(orderId, "That order has no captured payment. Nothing was restored.");
  }

  let previous: string | null;
  try {
    previous = await grantEntitlement(target.data, PLAN, orderId);
  } catch (err) {
    back(orderId, (err as Error).message);
  }

  await audit(admin, {
    action: "purchase.restore",
    subject: orderId,
    before: { user_id: record.purchase.user_id, entitlement: previous },
    after: { user_id: target.data, entitlement: "active" },
    reason: reason.data,
  });

  revalidatePath(`/admin/payments/${orderId}`);
  revalidatePath(`/admin/users/${target.data}`);
  back(orderId, "Premium attached to that account.");
}
