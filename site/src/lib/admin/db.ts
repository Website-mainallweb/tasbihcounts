import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Everything the panel reads, in one place.
 *
 * The shape of it: most of these call a SQL function from
 * supabase/migrations/20260915130000_admin_support.sql rather than assembling
 * the answer here. Two reasons. The interesting queries cross into `auth.users`
 * and `private.*`, which PostgREST does not expose at all. And a dashboard
 * number that is subtly wrong is worse than no dashboard, so the arithmetic
 * lives where it can be tested against a real Postgres —
 * site/tests/unit/db/admin.test.ts does exactly that.
 *
 * Every function here is called only from a page that has already run
 * requireAdmin(). The service role client bypasses row-level security, which is
 * the whole reason that rule is enforced by a build check and not by a habit.
 */

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "unknown error"}`);
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await createAdminClient().rpc(name, args);
  if (error) fail(`${name} failed`, error);
  return data as T;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export type Overview = {
  mode: "test" | "live";
  accounts: number;
  accounts_confirmed: number;
  signups_today: number;
  signups_7d: number;
  signups_30d: number;
  premium: number;
  revenue_paise: number;
  refunded_paise: number;
  purchases_open: number;
  webhook_events: number;
  reminders_on: number;
  devices: number;
  unreconciled: number;
};

export const overview = () => rpc<Overview>("admin_overview");

export type Unreconciled = {
  order_id: string;
  payment_id: string;
  checkout_email: string;
  user_id: string | null;
  state: string;
  amount: number;
  paid_at: string;
};

/** Captured payments with no Premium behind them. Expected to be empty. */
export const reconciliation = () => rpc<Unreconciled[]>("admin_reconciliation");

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

export type UserRow = {
  id: string;
  email: string;
  created_at: string;
  confirmed_at: string | null;
  last_sign_in: string | null;
  banned_until: string | null;
  premium: boolean;
  purchases: number;
  total_rows: number;
};

export type UserFilter = "all" | "premium" | "free" | "unconfirmed";

export function listUsers(q: string, filter: UserFilter, limit: number, offset: number) {
  return rpc<UserRow[]>("admin_users", { q, filter, lim: limit, off: offset });
}

export type UserDetail = {
  id: string;
  email: string;
  created_at: string;
  confirmed_at: string | null;
  last_sign_in: string | null;
  banned_until: string | null;
  premium: boolean;
  entitlements: {
    plan_id: string;
    mode: string;
    status: string;
    order_id: string | null;
    granted_at: string;
  }[];
  purchases: {
    order_id: string;
    state: string;
    mode: string;
    amount: number;
    currency: string;
    email: string;
    created_at: string;
  }[];
  devices: number;
  reminder: { enabled: boolean; zone: string; at: number; last_sent_day: string | null } | null;
  sync: {
    names: number;
    days: number;
    rows: number;
    last: string | null;
    settings_updated: string | null;
  };
};

/** Null when the id is not an account — a deleted one, or a mistyped URL. */
export const getUser = (id: string) => rpc<UserDetail | null>("admin_user", { target: id });

/* -------------------------------------------------------------------------- */
/* Purchases and payments                                                      */
/* -------------------------------------------------------------------------- */

export type PurchaseRow = {
  order_id: string;
  plan_id: string;
  expected_amount: number;
  expected_currency: string;
  mode: string;
  checkout_email: string;
  state: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentRow = {
  payment_id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  mode: string;
  created_at: string;
};

/**
 * What a search box entry means: an exact order id, or part of an email.
 *
 * Exported and pure so it can be tested. It was inline, and it lower-cased the
 * term before matching — which made every order-id search find nothing, because
 * Razorpay's ids are mixed case. A silent nothing, on the commonest thing
 * support does. See tests/unit/admin-search.test.ts.
 */
export function purchaseSearch(raw: string | undefined): { orderId?: string; email?: string } {
  const q = raw?.trim() ?? "";
  if (!q) return {};
  // Not lower-cased: an order id is matched exactly, and ilike is already
  // case-insensitive for the email.
  if (/^order_[A-Za-z0-9]{6,40}$/.test(q)) return { orderId: q };
  return { email: q };
}

export async function listPurchases(opts: {
  q?: string;
  state?: string;
  limit: number;
  offset: number;
}): Promise<{ rows: PurchaseRow[]; total: number }> {
  let query = createAdminClient()
    .from("purchases")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);

  /* Two separate filters rather than one `or`, because PostgREST's `or` syntax
     would need the value escaping and an email can contain its separators. */
  const search = purchaseSearch(opts.q);
  if (search.orderId) query = query.eq("order_id", search.orderId);
  else if (search.email) query = query.ilike("checkout_email", `%${search.email}%`);
  if (opts.state && opts.state !== "all") query = query.eq("state", opts.state);

  const { data, error, count } = await query;
  if (error) fail("Could not read purchases", error);
  return { rows: (data ?? []) as PurchaseRow[], total: count ?? 0 };
}

export async function getPurchase(orderId: string) {
  const db = createAdminClient();

  const { data: purchase, error } = await db
    .from("purchases")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) fail("Could not read the purchase", error);
  if (!purchase) return null;

  const { data: payments, error: payError } = await db
    .from("payments")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (payError) fail("Could not read its payments", payError);

  // The entitlement is looked up by account, not by order: a restored purchase
  // is attached to an account whose entitlement may name a different order.
  const p = purchase as PurchaseRow;
  let entitlements: { plan_id: string; mode: string; status: string; order_id: string | null }[] = [];
  if (p.user_id) {
    const { data, error: entError } = await db
      .from("entitlements")
      .select("plan_id, mode, status, order_id")
      .eq("user_id", p.user_id);
    if (entError) fail("Could not read the entitlement", entError);
    entitlements = data ?? [];
  }

  return { purchase: p, payments: (payments ?? []) as PaymentRow[], entitlements };
}

export type WebhookRow = {
  event_id: string;
  event_type: string;
  mode: string;
  received_at: string;
};

export async function listWebhooks(limit: number, offset: number) {
  const { data, error, count } = await createAdminClient()
    .from("webhook_events")
    .select("*", { count: "exact" })
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) fail("Could not read the webhook log", error);
  return { rows: (data ?? []) as WebhookRow[], total: count ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* Payment mode, flags, names                                                  */
/* -------------------------------------------------------------------------- */

export const paymentMode = () => rpc<"test" | "live">("admin_payment_mode");

export const setPaymentMode = (mode: "test" | "live") =>
  rpc<"test" | "live">("admin_set_payment_mode", { new_mode: mode });

export type Flag = { key: string; enabled: boolean; note: string; updated_at: string };

export async function listFlags(): Promise<Flag[]> {
  const { data, error } = await createAdminClient()
    .from("app_flags")
    .select("*")
    .order("key", { ascending: true });
  if (error) fail("Could not read the switches", error);
  return (data ?? []) as Flag[];
}

export async function setFlag(key: string, enabled: boolean): Promise<void> {
  const { error } = await createAdminClient()
    .from("app_flags")
    .update({ enabled })
    .eq("key", key);
  if (error) fail(`Could not change the ${key} switch`, error);
}

export type NameRow = {
  id: string;
  devanagari: string;
  transliteration: string;
  meaning: string;
  grp: "mantra" | null;
  position: number;
  published: boolean;
  updated_at: string;
};

export async function listNames(): Promise<NameRow[]> {
  const { data, error } = await createAdminClient()
    .from("names")
    .select("*")
    .order("position", { ascending: true });
  if (error) fail("Could not read the name library", error);
  return (data ?? []) as NameRow[];
}

export async function getName(id: string): Promise<NameRow | null> {
  const { data, error } = await createAdminClient()
    .from("names")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("Could not read the name", error);
  return (data as NameRow) ?? null;
}

export async function upsertName(row: Omit<NameRow, "updated_at">, isNew: boolean): Promise<void> {
  const db = createAdminClient();
  const { error } = isNew
    ? await db.from("names").insert(row)
    : // The id is deliberately not in the update: the database refuses to change
      // it anyway, and leaving it out means the intent is visible here too.
      await db
        .from("names")
        .update({
          devanagari: row.devanagari,
          transliteration: row.transliteration,
          meaning: row.meaning,
          grp: row.grp,
          position: row.position,
          published: row.published,
        })
        .eq("id", row.id);
  if (error) fail("Could not save the name", error);
}

/* -------------------------------------------------------------------------- */
/* Entitlements                                                                */
/* -------------------------------------------------------------------------- */

/** Returns the status that was there before, or null if there was none. */
export const grantEntitlement = (target: string, plan: string, orderId?: string) =>
  rpc<string | null>("admin_grant_entitlement", {
    target,
    plan,
    order_ref: orderId ?? null,
  });

export const revokeEntitlement = (target: string, plan: string) =>
  rpc<string | null>("admin_revoke_entitlement", { target, plan });

/* -------------------------------------------------------------------------- */
/* Reminders, analytics, system                                                */
/* -------------------------------------------------------------------------- */

export type ReminderRow = {
  user_id: string;
  enabled: boolean;
  zone: string;
  remind_at: number;
  last_sent_day: string | null;
  updated_at: string;
};

export async function listReminders(limit: number, offset: number) {
  const { data, error, count } = await createAdminClient()
    .from("reminder_settings")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) fail("Could not read reminder settings", error);
  return { rows: (data ?? []) as ReminderRow[], total: count ?? 0 };
}

export type Analytics = {
  synced_users: number;
  synced_japs: number;
  synced_rounds: number;
  active_7d: number;
  active_30d: number;
  /** Japs recorded before the counter tracked names — real, but nameless. */
  unnamed_japs: number;
  top_names: { naam_id: string; japs: number; people: number }[];
  funnel: { accounts: number; started: number; paid: number };
};

export const analytics = () => rpc<Analytics>("admin_analytics");

export const tableCounts = () => rpc<Record<string, number>>("admin_table_counts");

/* -------------------------------------------------------------------------- */
/* Account operations                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The three writes that go through Supabase's Auth admin API or a database
 * function rather than a table.
 *
 * They live here, with the rest of the panel's data access, so that the actions
 * in app/admin never import the service role client themselves. That keeps the
 * eslint rule protecting the rest of the application meaningful: exactly two
 * files in lib/admin may reach past row-level security, and both are behind
 * requireAdmin() by construction.
 */

/** Mark an email confirmed by hand — the mail that went to spam. */
export async function confirmUserEmail(id: string): Promise<void> {
  const { error } = await createAdminClient().auth.admin.updateUserById(id, { email_confirm: true });
  if (error) fail("Could not confirm that email", error);
}

/**
 * Suspend or restore. Supabase's ban is on the session, not the data: a
 * suspended account cannot sign in, keeps everything, and comes back exactly as
 * it was. 100 years because there is no "forever" and a duration that outlives
 * the product is the same thing in practice.
 */
export async function setUserSuspended(id: string, suspended: boolean): Promise<void> {
  const { error } = await createAdminClient().auth.admin.updateUserById(id, {
    ban_duration: suspended ? "876000h" : "none",
  });
  if (error) fail("Could not change that account", error);
}

/**
 * Delete an account, through the same `delete_account` function the person's own
 * account page calls (ARCHITECTURE M4): tombstone first, then the user, so a
 * late webhook or a phone that has been offline for a week cannot resurrect what
 * its owner removed.
 */
export async function deleteUserAccount(id: string): Promise<void> {
  const { error } = await createAdminClient().rpc("delete_account", { target: id });
  if (error) fail("Could not delete that account", error);
}
