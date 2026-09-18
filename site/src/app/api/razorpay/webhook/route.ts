import { signInLinkOrigin } from "@/lib/payments/origin";
import { currentMode, isValidWebhookFor, razorpayApi } from "@/lib/payments/razorpay";
import { reconcile, reconcileRefund } from "@/lib/payments/reconcile";
import { supabasePurchaseStore } from "@/lib/payments/store";

/**
 * Razorpay's webhook. Assume the URL is public, because it is (SECURITY §4).
 *
 * In order, and nothing before the first step:
 *   1. the HMAC over the RAW body, compared in constant time
 *   2. the delivery logged against its event id
 *   3. the purchase carried forward by reconcile(), which reads the payment from
 *      Razorpay and checks amount, currency and mode against our own row
 *
 * The event id is logged, never used to skip work: "seen it, return 2xx" would
 * strand a buyer whose first delivery died half way. reconcile() is idempotent,
 * so a duplicate simply finds everything already done.
 *
 * A 500 when reconciling fails, so Razorpay retries; a 2xx once the purchase has
 * gone as far as the facts allow. No user session exists here — listed in
 * scripts/check-auth-handlers.mjs; the signature is the authentication.
 */

const MAX_BODY = 256_000;

type Event = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string } };
    order?: { entity?: { id?: string } };
    refund?: { entity?: { payment_id?: string } };
  };
};

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response("too large", { status: 413 });

  if (!isValidWebhookFor(raw, request.headers.get("x-razorpay-signature"))) {
    return new Response("bad signature", { status: 400 });
  }

  let event: Event;
  try {
    event = JSON.parse(raw) as Event;
  } catch {
    return new Response("bad body", { status: 400 });
  }

  const mode = currentMode();
  const store = supabasePurchaseStore();
  const type = event.event ?? "unknown";

  try {
    const eventId = request.headers.get("x-razorpay-event-id");
    if (eventId) await store.recordEvent(eventId.slice(0, 128), type, mode);

    switch (type) {
      case "payment.authorized":
      case "payment.captured":
      case "order.paid": {
        const orderId = event.payload?.payment?.entity?.order_id ?? event.payload?.order?.entity?.id;
        if (orderId) {
          await reconcile(orderId, { store, razorpay: razorpayApi, mode, origin: signInLinkOrigin() });
        }
        break;
      }
      case "refund.processed":
      case "payment.refunded": {
        const paymentId = event.payload?.refund?.entity?.payment_id ?? event.payload?.payment?.entity?.id;
        if (paymentId) await reconcileRefund(paymentId, { store, razorpay: razorpayApi, mode });
        break;
      }
      default:
        // Every other event is acknowledged and ignored.
        break;
    }
  } catch {
    // Nothing about the failure goes back to the caller. Razorpay retries.
    return new Response("retry", { status: 500 });
  }

  return Response.json({ ok: true });
}
