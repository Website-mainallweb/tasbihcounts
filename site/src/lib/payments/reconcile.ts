/**
 * The purchase state machine (docs/ARCHITECTURE.md §4).
 *
 *   created -> payment_verified -> captured -> user_created
 *           -> entitlement_active -> notified
 *
 * reconcile() does not do one step. It re-runs from wherever the purchase is and
 * carries it as far forward as the facts allow, every time it is called — by the
 * webhook, by the checkout callback, by a status poll. So a run that died after
 * creating the user but before granting the entitlement is finished by the next
 * call, instead of leaving a paying buyer with no Premium. "The row exists,
 * return 2xx" is not idempotency; reaching the final state is.
 *
 * The money is checked against OUR purchase row — amount, currency and mode —
 * and the payment is read from Razorpay's API, never taken from the browser.
 *
 * Pure: storage and Razorpay are passed in, so every path is unit tested.
 */

export type PurchaseState =
  | "created"
  | "payment_verified"
  | "captured"
  | "user_created"
  | "entitlement_active"
  | "notified"
  | "failed_recoverable"
  | "refunded"
  | "revoked";

export type Mode = "test" | "live";

export type Purchase = {
  orderId: string;
  planId: string;
  expectedAmount: number;
  expectedCurrency: string;
  mode: Mode;
  checkoutEmail: string;
  state: PurchaseState;
  userId: string | null;
};

export type RzPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method?: string | null;
  amount_refunded?: number;
};

export type RazorpayApi = {
  orderPayments(orderId: string): Promise<RzPayment[]>;
  payment(paymentId: string): Promise<RzPayment>;
  capture(paymentId: string, amount: number, currency: string): Promise<RzPayment>;
};

export type PurchaseStore = {
  getPurchase(orderId: string): Promise<Purchase | null>;
  /** Forward only; a no-op when the purchase is already at or past `to`. */
  advance(orderId: string, to: PurchaseState, patch?: { userId?: string }): Promise<void>;
  recordPayment(p: {
    paymentId: string;
    orderId: string;
    amount: number;
    currency: string;
    status: "captured" | "refunded";
    method: string | null;
    mode: Mode;
  }): Promise<void>;
  findUserIdByEmail(email: string): Promise<string | null>;
  /** Creates the account, or returns the existing id if it was created meanwhile. */
  createUser(email: string): Promise<string>;
  grantEntitlement(e: { userId: string; planId: string; mode: Mode; orderId: string }): Promise<void>;
  revokeEntitlement(orderId: string): Promise<void>;
  markRefunded(orderId: string): Promise<void>;
  /** The "your Premium is ready" sign-in email. */
  sendSignInEmail(email: string, origin: string): Promise<void>;
};

export type Outcome = {
  state: PurchaseState | "unknown";
  /** Premium is granted. */
  active: boolean;
  /** Nothing captured yet; worth asking again shortly. */
  waiting: boolean;
};

const HAPPY_PATH: PurchaseState[] = [
  "created",
  "payment_verified",
  "captured",
  "user_created",
  "entitlement_active",
  "notified",
];

/** Position on the happy path; -1 for failed_recoverable (everything re-runs). */
export function rank(state: PurchaseState): number {
  return HAPPY_PATH.indexOf(state);
}

export async function reconcile(
  orderId: string,
  deps: { store: PurchaseStore; razorpay: RazorpayApi; mode: Mode; origin: string },
): Promise<Outcome> {
  const { store, razorpay, mode, origin } = deps;

  const p = await store.getPurchase(orderId);
  if (!p) return { state: "unknown", active: false, waiting: false };
  if (p.state === "refunded" || p.state === "revoked") return { state: p.state, active: false, waiting: false };

  // A test-mode purchase is never carried forward under live keys, or the other
  // way round (ARCHITECTURE M6).
  if (p.mode !== mode) return { state: p.state, active: false, waiting: false };

  let state = p.state;

  // 1. The money.
  if (rank(state) < rank("captured")) {
    const matches = (x: RzPayment) => x.amount === p.expectedAmount && x.currency === p.expectedCurrency;
    const payments = await razorpay.orderPayments(orderId);

    let paid = payments.find((x) => x.status === "captured" && matches(x));
    if (!paid) {
      const authorized = payments.find((x) => x.status === "authorized" && matches(x));
      if (authorized) paid = await razorpay.capture(authorized.id, p.expectedAmount, p.expectedCurrency);
    }
    if (!paid || paid.status !== "captured" || !matches(paid) || paid.order_id !== orderId) {
      return { state, active: false, waiting: true };
    }

    await store.recordPayment({
      paymentId: paid.id,
      orderId,
      amount: paid.amount,
      currency: paid.currency,
      status: "captured",
      method: paid.method ?? null,
      mode,
    });
    await store.advance(orderId, "captured");
    state = "captured";
  }

  // An account that was attached and then deleted stays deleted. Its purchase
  // keeps its state with user_id cleared; recreating the account here would undo
  // the owner's deletion.
  if (rank(state) >= rank("user_created") && !p.userId) {
    return { state, active: false, waiting: false };
  }

  // 2. The account, created by the payment and by nothing else.
  let userId = p.userId;
  if (rank(state) < rank("user_created")) {
    userId = userId ?? (await store.findUserIdByEmail(p.checkoutEmail)) ?? (await store.createUser(p.checkoutEmail));
    await store.advance(orderId, "user_created", { userId });
    state = "user_created";
  }

  // 3. The entitlement.
  if (rank(state) < rank("entitlement_active")) {
    await store.grantEntitlement({ userId: userId!, planId: p.planId, mode, orderId });
    await store.advance(orderId, "entitlement_active");
    state = "entitlement_active";
  }

  // 4. The email. A courtesy: the buyer can sign in without it, so a mail
  // failure leaves Premium active and is retried on the next call.
  if (rank(state) < rank("notified")) {
    try {
      await store.sendSignInEmail(p.checkoutEmail, origin);
      await store.advance(orderId, "notified");
      state = "notified";
    } catch {
      // Left at entitlement_active.
    }
  }

  return { state, active: true, waiting: false };
}

/**
 * A refund. Premium is withdrawn only when the whole payment was refunded — the
 * refund policy offers refunds for technical failures, and a partial refund of
 * an overcharge leaves the purchase standing.
 */
export async function reconcileRefund(
  paymentId: string,
  deps: { store: PurchaseStore; razorpay: RazorpayApi; mode: Mode },
): Promise<"revoked" | "ignored"> {
  const { store, razorpay, mode } = deps;
  const payment = await razorpay.payment(paymentId);
  if (!payment.order_id) return "ignored";

  const p = await store.getPurchase(payment.order_id);
  if (!p || p.mode !== mode) return "ignored";
  if ((payment.amount_refunded ?? 0) < payment.amount) return "ignored";

  await store.recordPayment({
    paymentId: payment.id,
    orderId: p.orderId,
    amount: payment.amount,
    currency: payment.currency,
    status: "refunded",
    method: payment.method ?? null,
    mode,
  });
  await store.revokeEntitlement(p.orderId);
  await store.markRefunded(p.orderId);
  return "revoked";
}
