import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseEnv } from "@/lib/env.server";
import { createAdminClient } from "@/lib/supabase/admin";

import { rank, type Mode, type Purchase, type PurchaseState, type PurchaseStore } from "./reconcile";

/**
 * The purchase store on Supabase, through the service role — the webhook and the
 * checkout routes have no user session (docs/SECURITY.md §2). Every write here is
 * also constrained by the database itself: the purchase guard refuses to rewrite
 * an order or move its state backwards, whoever holds the key.
 *
 * Kept in this one module so no route imports the service role client itself.
 */

type Row = {
  order_id: string;
  plan_id: string;
  expected_amount: number;
  expected_currency: string;
  mode: Mode;
  checkout_email: string;
  state: PurchaseState;
  user_id: string | null;
};

/** The checkout-side writes, on top of what reconcile() needs. */
export type CheckoutStore = PurchaseStore & {
  createPurchase(row: {
    orderId: string;
    planId: string;
    amount: number;
    currency: string;
    mode: Mode;
    email: string;
  }): Promise<void>;
  /** Orders started with this email in the last hour. */
  countRecentPurchases(email: string): Promise<number>;
  /** Whether the account with this email already holds Premium in this mode. */
  hasActivePremium(email: string, mode: Mode): Promise<boolean>;
  /** Logs a webhook delivery once. Never used to skip work: see the webhook route. */
  recordEvent(eventId: string, type: string, mode: Mode): Promise<void>;
};

const HAPPY_PATH: PurchaseState[] = [
  "created",
  "payment_verified",
  "captured",
  "user_created",
  "entitlement_active",
  "notified",
];

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "unknown error"}`);
}

export function supabasePurchaseStore(db: SupabaseClient = createAdminClient()): CheckoutStore {
  async function findUserIdByEmail(email: string): Promise<string | null> {
    const { data, error } = await db.rpc("find_user_id_by_email", { target_email: email });
    if (error) fail("looking up buyer", error);
    return (data as string | null) ?? null;
  }

  return {
    async getPurchase(orderId) {
      const { data, error } = await db
        .from("purchases")
        .select("order_id, plan_id, expected_amount, expected_currency, mode, checkout_email, state, user_id")
        .eq("order_id", orderId)
        .maybeSingle<Row>();
      if (error) fail("reading purchase", error);
      if (!data) return null;
      const p: Purchase = {
        orderId: data.order_id,
        planId: data.plan_id,
        expectedAmount: data.expected_amount,
        expectedCurrency: data.expected_currency,
        mode: data.mode,
        checkoutEmail: data.checkout_email,
        state: data.state,
        userId: data.user_id,
      };
      return p;
    },

    async advance(orderId, to, patch) {
      // Only rows that are behind `to` are touched, so two workers racing each
      // other both succeed and neither moves the purchase backwards.
      const behind = [...HAPPY_PATH.slice(0, rank(to)), "failed_recoverable"];
      const update: Record<string, unknown> = { state: to };
      if (patch?.userId) update.user_id = patch.userId;
      const { error } = await db.from("purchases").update(update).eq("order_id", orderId).in("state", behind);
      if (error) fail(`advancing purchase to ${to}`, error);
    },

    async recordPayment(p) {
      const { error } = await db.from("payments").upsert(
        {
          payment_id: p.paymentId,
          order_id: p.orderId,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          method: p.method,
          mode: p.mode,
        },
        { onConflict: "payment_id" },
      );
      if (error) fail("recording payment", error);
    },

    findUserIdByEmail,

    async createUser(email) {
      const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
      if (data?.user) return data.user.id;
      // Created by a concurrent run between the lookup and here.
      const existing = await findUserIdByEmail(email);
      if (existing) return existing;
      fail("creating buyer account", error);
    },

    async grantEntitlement(e) {
      const { error } = await db
        .from("entitlements")
        .upsert(
          { user_id: e.userId, plan_id: e.planId, mode: e.mode, status: "active", order_id: e.orderId },
          { onConflict: "user_id,plan_id,mode" },
        );
      if (error) fail("granting entitlement", error);
    },

    async revokeEntitlement(orderId) {
      const { error } = await db.from("entitlements").update({ status: "revoked" }).eq("order_id", orderId);
      if (error) fail("revoking entitlement", error);
    },

    async markRefunded(orderId) {
      const { error } = await db
        .from("purchases")
        .update({ state: "refunded" })
        .eq("order_id", orderId)
        .not("state", "in", "(refunded,revoked)");
      if (error) fail("marking purchase refunded", error);
    },

    async sendSignInEmail(email, origin) {
      const { url, anonKey } = supabaseEnv();
      const anon = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { error } = await anon.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback/?next=/account/` },
      });
      if (error) fail("sending sign-in email", error);
    },

    async createPurchase(row) {
      const { error } = await db.from("purchases").insert({
        order_id: row.orderId,
        plan_id: row.planId,
        expected_amount: row.amount,
        expected_currency: row.currency,
        mode: row.mode,
        checkout_email: row.email,
      });
      if (error) fail("recording order", error);
    },

    async countRecentPurchases(email) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error } = await db
        .from("purchases")
        .select("order_id", { count: "exact", head: true })
        .eq("checkout_email", email)
        .gte("created_at", since);
      if (error) fail("counting recent orders", error);
      return count ?? 0;
    },

    async hasActivePremium(email, mode) {
      const userId = await findUserIdByEmail(email);
      if (!userId) return false;
      const { count, error } = await db
        .from("entitlements")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("mode", mode)
        .eq("status", "active");
      if (error) fail("checking existing Premium", error);
      return (count ?? 0) > 0;
    },

    async recordEvent(eventId, type, mode) {
      const { error } = await db
        .from("webhook_events")
        .upsert(
          { event_id: eventId, event_type: type.slice(0, 64), mode },
          { onConflict: "event_id", ignoreDuplicates: true },
        );
      if (error) fail("logging webhook event", error);
    },
  };
}
