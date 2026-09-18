import { createHmac } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import {
  rank,
  reconcile,
  reconcileRefund,
  type Mode,
  type Purchase,
  type PurchaseState,
  type PurchaseStore,
  type RazorpayApi,
  type RzPayment,
} from "../../src/lib/payments/reconcile";
import { hmacHex, isValidCheckout, isValidWebhook, sameHex } from "../../src/lib/payments/signatures";

/**
 * The payment rules that decide who gets Premium (ARCHITECTURE §4, SECURITY §4).
 * Razorpay and the database are replaced with fakes that behave like the real
 * thing where it matters: the store only moves a purchase forward.
 */

const SECRET = "unit-test-webhook-secret-0123456789";

describe("signatures", () => {
  const body = JSON.stringify({ event: "payment.captured", payload: { a: 1 } });
  const good = createHmac("sha256", SECRET).update(body).digest("hex");

  test("a webhook signed with the secret over the raw body is valid", () => {
    expect(isValidWebhook(body, good, SECRET)).toBe(true);
  });

  test.each([
    ["no signature", null],
    ["an empty signature", ""],
    ["a signature for other bytes", createHmac("sha256", SECRET).update(body + " ").digest("hex")],
    ["a signature with the wrong secret", createHmac("sha256", "another-secret").update(body).digest("hex")],
    ["an uppercase copy", good.toUpperCase()],
    ["a truncated signature", good.slice(0, 40)],
    ["non-hex garbage of the right length", "z".repeat(64)],
  ])("refuses %s", (_label, signature) => {
    expect(isValidWebhook(body, signature, SECRET)).toBe(false);
  });

  test("re-serialising the body breaks the signature, which is why the raw text is used", () => {
    const reserialised = JSON.stringify(JSON.parse(`{ "event" : "payment.captured", "payload": {"a":1} }`));
    const signedOriginal = createHmac("sha256", SECRET)
      .update(`{ "event" : "payment.captured", "payload": {"a":1} }`)
      .digest("hex");
    expect(isValidWebhook(reserialised, signedOriginal, SECRET)).toBe(false);
  });

  test("the checkout signature covers order_id|payment_id", () => {
    const sig = hmacHex("key-secret", "order_ABC123|pay_XYZ789");
    expect(isValidCheckout("order_ABC123", "pay_XYZ789", sig, "key-secret")).toBe(true);
    expect(isValidCheckout("order_ABC123", "pay_OTHER1", sig, "key-secret")).toBe(false);
    expect(isValidCheckout("order_ABC123", "pay_XYZ789", sig, "wrong-secret")).toBe(false);
    expect(isValidCheckout("", "pay_XYZ789", sig, "key-secret")).toBe(false);
  });

  test("sameHex refuses a length mismatch instead of throwing", () => {
    expect(sameHex("abcd", "abcdef")).toBe(false);
  });
});

/* ---------------------------------------------------------------- fakes */

const ORDER = "order_TEST0001";
const EMAIL = "buyer@test.local";

function purchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    orderId: ORDER,
    planId: "premium_lifetime_v1",
    expectedAmount: 20000,
    expectedCurrency: "INR",
    mode: "test",
    checkoutEmail: EMAIL,
    state: "created",
    userId: null,
    ...overrides,
  };
}

function payment(overrides: Partial<RzPayment> = {}): RzPayment {
  return {
    id: "pay_TEST0001",
    order_id: ORDER,
    amount: 20000,
    currency: "INR",
    status: "captured",
    method: "upi",
    ...overrides,
  };
}

function fakeStore(initial: Purchase | null, opts: { existingUser?: string; failOn?: Partial<Record<keyof PurchaseStore, number>> } = {}) {
  let row = initial ? { ...initial } : null;
  const payments = new Map<string, { status: string }>();
  const entitlements = new Map<string, { status: string; orderId: string }>();
  const users = new Map<string, string>(opts.existingUser ? [[EMAIL, opts.existingUser]] : []);
  const failures = { ...(opts.failOn ?? {}) } as Record<string, number>;
  const calls: string[] = [];

  const maybeFail = (name: string) => {
    calls.push(name);
    if (failures[name] && failures[name] > 0) {
      failures[name] -= 1;
      throw new Error(`${name} failed`);
    }
  };

  const store: PurchaseStore = {
    async getPurchase(orderId) {
      return row && row.orderId === orderId ? { ...row } : null;
    },
    async advance(_orderId, to, patch) {
      maybeFail("advance");
      if (!row) return;
      const behind = rank(row.state) < rank(to) || row.state === "failed_recoverable";
      if (!behind) return;
      row = { ...row, state: to, userId: patch?.userId ?? row.userId };
    },
    async recordPayment(p) {
      maybeFail("recordPayment");
      payments.set(p.paymentId, { status: p.status });
    },
    async findUserIdByEmail(email) {
      maybeFail("findUserIdByEmail");
      return users.get(email) ?? null;
    },
    async createUser(email) {
      maybeFail("createUser");
      const id = `user-${users.size + 1}`;
      users.set(email, id);
      return id;
    },
    async grantEntitlement(e) {
      maybeFail("grantEntitlement");
      entitlements.set(`${e.userId}|${e.planId}|${e.mode}`, { status: "active", orderId: e.orderId });
    },
    async revokeEntitlement(orderId) {
      maybeFail("revokeEntitlement");
      for (const [k, v] of entitlements) if (v.orderId === orderId) entitlements.set(k, { ...v, status: "revoked" });
    },
    async markRefunded() {
      maybeFail("markRefunded");
      if (row) row = { ...row, state: "refunded" };
    },
    async sendSignInEmail() {
      maybeFail("sendSignInEmail");
    },
  };

  return {
    store,
    calls,
    get row() {
      return row;
    },
    payments,
    entitlements,
    users,
  };
}

function fakeRazorpay(payments: RzPayment[]): RazorpayApi & { captured: string[] } {
  const captured: string[] = [];
  return {
    captured,
    orderPayments: vi.fn(async () => payments.map((p) => ({ ...p }))),
    payment: vi.fn(async (id: string) => ({ ...payments.find((p) => p.id === id)! })),
    capture: vi.fn(async (id: string) => {
      captured.push(id);
      return { ...payments.find((p) => p.id === id)!, status: "captured" as const };
    }),
  };
}

const deps = (store: PurchaseStore, razorpay: RazorpayApi, mode: Mode = "test") => ({
  store,
  razorpay,
  mode,
  origin: "http://localhost:3000",
});

/* ---------------------------------------------------------------- reconcile */

describe("reconcile: a captured payment becomes Premium", () => {
  test("carries a fresh purchase all the way to notified", async () => {
    const f = fakeStore(purchase());
    const out = await reconcile(ORDER, deps(f.store, fakeRazorpay([payment()])));

    expect(out).toEqual({ state: "notified", active: true, waiting: false });
    expect(f.row!.state).toBe("notified");
    expect(f.users.get(EMAIL)).toBe("user-1");
    expect(f.entitlements.get("user-1|premium_lifetime_v1|test")).toEqual({ status: "active", orderId: ORDER });
    expect(f.payments.get("pay_TEST0001")).toEqual({ status: "captured" });
  });

  test("uses the buyer's existing account instead of creating a second one", async () => {
    const f = fakeStore(purchase(), { existingUser: "user-existing" });
    await reconcile(ORDER, deps(f.store, fakeRazorpay([payment()])));
    expect(f.calls).not.toContain("createUser");
    expect(f.entitlements.has("user-existing|premium_lifetime_v1|test")).toBe(true);
  });

  test("captures an authorised payment first", async () => {
    const f = fakeStore(purchase());
    const rz = fakeRazorpay([payment({ status: "authorized" })]);
    const out = await reconcile(ORDER, deps(f.store, rz));
    expect(rz.captured).toEqual(["pay_TEST0001"]);
    expect(out.active).toBe(true);
  });

  test("running it again changes nothing and creates nothing twice", async () => {
    const f = fakeStore(purchase());
    const rz = fakeRazorpay([payment()]);
    await reconcile(ORDER, deps(f.store, rz));
    const callsAfterFirst = f.calls.length;

    const again = await reconcile(ORDER, deps(f.store, rz));
    expect(again).toEqual({ state: "notified", active: true, waiting: false });
    expect(f.users.size).toBe(1);
    expect(f.calls.slice(callsAfterFirst)).toEqual([]);
  });
});

describe("reconcile: the money must be exactly right", () => {
  test.each([
    ["no payment yet", []],
    ["a failed payment", [payment({ status: "failed" })]],
    ["one rupee", [payment({ amount: 100 })]],
    ["the right amount in dollars", [payment({ currency: "USD" })]],
    ["a payment belonging to another order", [payment({ order_id: "order_OTHER001" })]],
  ])("grants nothing for %s", async (_label, payments) => {
    const f = fakeStore(purchase());
    const out = await reconcile(ORDER, deps(f.store, fakeRazorpay(payments as RzPayment[])));
    expect(out).toEqual({ state: "created", active: false, waiting: true });
    expect(f.entitlements.size).toBe(0);
    expect(f.users.size).toBe(0);
  });

  test("a test-mode purchase is not carried forward under live keys", async () => {
    const f = fakeStore(purchase({ mode: "test" }));
    const rz = fakeRazorpay([payment()]);
    const out = await reconcile(ORDER, deps(f.store, rz, "live"));
    expect(out.active).toBe(false);
    expect(rz.orderPayments).not.toHaveBeenCalled();
  });

  test("an order that is not ours is left alone", async () => {
    const f = fakeStore(null);
    expect(await reconcile("order_NOTOURS1", deps(f.store, fakeRazorpay([payment()])))).toEqual({
      state: "unknown",
      active: false,
      waiting: false,
    });
  });
});

describe("reconcile: a run that died part way is finished by the next one", () => {
  test.each<[keyof PurchaseStore, PurchaseState]>([
    ["recordPayment", "created"],
    ["createUser", "captured"],
    ["grantEntitlement", "user_created"],
  ])("when %s failed, the retry reaches Premium", async (step, stuckAt) => {
    const f = fakeStore(purchase(), { failOn: { [step]: 1 } });
    const rz = fakeRazorpay([payment()]);

    await expect(reconcile(ORDER, deps(f.store, rz))).rejects.toThrow(`${step} failed`);
    expect(f.row!.state).toBe(stuckAt);

    const retry = await reconcile(ORDER, deps(f.store, rz));
    expect(retry).toEqual({ state: "notified", active: true, waiting: false });
    expect(f.users.size).toBe(1);
    expect(f.entitlements.size).toBe(1);
  });

  test("a failed email leaves Premium active and is tried again later", async () => {
    const f = fakeStore(purchase(), { failOn: { sendSignInEmail: 1 } });
    const rz = fakeRazorpay([payment()]);

    const first = await reconcile(ORDER, deps(f.store, rz));
    expect(first).toEqual({ state: "entitlement_active", active: true, waiting: false });

    const second = await reconcile(ORDER, deps(f.store, rz));
    expect(second.state).toBe("notified");
  });

  test("failed_recoverable re-runs from the start without duplicating anything", async () => {
    const f = fakeStore(purchase({ state: "failed_recoverable" }), { existingUser: "user-7" });
    const out = await reconcile(ORDER, deps(f.store, fakeRazorpay([payment()])));
    expect(out.active).toBe(true);
    expect(f.users.size).toBe(1);
  });
});

describe("reconcile: things that must stay as they are", () => {
  test("a deleted account is not recreated by a late webhook", async () => {
    const f = fakeStore(purchase({ state: "notified", userId: null }));
    const out = await reconcile(ORDER, deps(f.store, fakeRazorpay([payment()])));
    expect(out).toEqual({ state: "notified", active: false, waiting: false });
    expect(f.calls).not.toContain("createUser");
    expect(f.calls).not.toContain("grantEntitlement");
  });

  test.each<PurchaseState>(["refunded", "revoked"])("a %s purchase is final", async (state) => {
    const f = fakeStore(purchase({ state, userId: "user-1" }));
    const rz = fakeRazorpay([payment()]);
    const out = await reconcile(ORDER, deps(f.store, rz));
    expect(out.active).toBe(false);
    expect(rz.orderPayments).not.toHaveBeenCalled();
  });
});

describe("refunds", () => {
  test("a full refund withdraws Premium and marks the purchase refunded", async () => {
    const f = fakeStore(purchase());
    const rz = fakeRazorpay([payment()]);
    await reconcile(ORDER, deps(f.store, rz));

    const refundRz = fakeRazorpay([payment({ status: "refunded", amount_refunded: 20000 })]);
    expect(await reconcileRefund("pay_TEST0001", { store: f.store, razorpay: refundRz, mode: "test" })).toBe("revoked");
    expect(f.row!.state).toBe("refunded");
    expect(f.entitlements.get("user-1|premium_lifetime_v1|test")!.status).toBe("revoked");

    // And nothing brings it back.
    const after = await reconcile(ORDER, deps(f.store, rz));
    expect(after.active).toBe(false);
  });

  test("a partial refund of an overcharge leaves Premium standing", async () => {
    const f = fakeStore(purchase());
    await reconcile(ORDER, deps(f.store, fakeRazorpay([payment()])));
    const partial = fakeRazorpay([payment({ amount_refunded: 5000 })]);
    expect(await reconcileRefund("pay_TEST0001", { store: f.store, razorpay: partial, mode: "test" })).toBe("ignored");
    expect(f.row!.state).toBe("notified");
  });

  test("a refund for an order that is not ours is ignored", async () => {
    const f = fakeStore(null);
    const rz = fakeRazorpay([payment({ order_id: "order_ELSEWHR1", amount_refunded: 20000 })]);
    expect(await reconcileRefund("pay_TEST0001", { store: f.store, razorpay: rz, mode: "test" })).toBe("ignored");
  });
});
