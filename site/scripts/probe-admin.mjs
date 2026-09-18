/**
 * Every read the panel does, run against the real project.
 *
 *   node scripts/probe-live.mjs
 *
 * Read-only. It writes nothing, changes nothing, and touches no account.
 *
 * What it is for: the panel's screens sit behind Google sign-in, which is exactly
 * right and also means their queries cannot be exercised by anything that is not
 * signed in as Rajan. This runs the same queries the same way — every table,
 * every function, every argument — so that a wrong column name or a renamed
 * function fails here, in a second, rather than on the evening a buyer is
 * waiting.
 *
 * It mirrors src/lib/admin/db.ts rather than importing it (that module is
 * `server-only` and resolves Next's `@/` alias). Keep the two in step: if a query
 * changes there, change it here, or this stops meaning anything.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const results = [];
let failed = 0;

async function probe(screen, what, run) {
  try {
    const summary = await run();
    results.push(`  ok    ${what.padEnd(34)} ${summary}`);
  } catch (err) {
    failed += 1;
    results.push(`  FAIL  ${what.padEnd(34)} ${err.message}`);
  }
  results.screen = screen;
}

const rpc = async (name, args = {}) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
  return data;
};

const from = async (table, build) => {
  const { data, error, count } = await build(db.from(table));
  if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
  return { rows: data ?? [], count };
};

console.log("Overview");
await probe("overview", "admin_overview()", async () => {
  const o = await rpc("admin_overview");
  return `${o.accounts} accounts, ${o.premium} premium, ${(o.revenue_paise / 100).toFixed(0)} INR, ${o.unreconciled} unreconciled`;
});
await probe("overview", "admin_reconciliation()", async () => {
  const rows = await rpc("admin_reconciliation");
  return `${rows.length} payment(s) without Premium`;
});

console.log("\nUsers");
for (const filter of ["all", "premium", "free", "unconfirmed"]) {
  await probe("users", `admin_users(filter=${filter})`, async () => {
    const rows = await rpc("admin_users", { q: "", filter, lim: 50, off: 0 });
    return `${rows.length} row(s)`;
  });
}
await probe("users", "admin_users(search)", async () => {
  const rows = await rpc("admin_users", { q: "@", filter: "all", lim: 50, off: 0 });
  return `${rows.length} row(s) match "@"`;
});
await probe("users", "admin_user(detail)", async () => {
  const [first] = await rpc("admin_users", { q: "", filter: "all", lim: 1, off: 0 });
  if (!first) return "no accounts to inspect";
  const u = await rpc("admin_user", { target: first.id });
  if (!u) throw new Error("admin_user returned null for an id admin_users listed");
  return `${u.purchases.length} purchase(s), ${u.sync.names} name(s) synced, premium=${u.premium}`;
});
await probe("users", "admin_user(unknown id)", async () => {
  const u = await rpc("admin_user", { target: "00000000-0000-4000-8000-0000000000ff" });
  if (u !== null) throw new Error("expected null for an id that is not an account");
  return "null, as it should be";
});

console.log("\nPayments");
await probe("payments", "purchases list + count", async () => {
  const { rows, count } = await from("purchases", (q) =>
    q.select("*", { count: "exact" }).order("created_at", { ascending: false }).range(0, 49),
  );
  return `${rows.length} shown of ${count}`;
});
await probe("payments", "purchases filtered by state", async () => {
  const { count } = await from("purchases", (q) =>
    q.select("*", { count: "exact" }).eq("state", "notified").range(0, 49),
  );
  return `${count} notified`;
});
await probe("payments", "purchase detail + payments", async () => {
  const { rows } = await from("purchases", (q) =>
    q.select("*").order("created_at", { ascending: false }).limit(1),
  );
  if (!rows[0]) return "no purchases to inspect";
  const order = rows[0].order_id;
  const pay = await from("payments", (q) =>
    q.select("*").eq("order_id", order).order("created_at", { ascending: true }),
  );
  return `${order}: ${pay.rows.length} payment(s)`;
});
await probe("payments", "search by checkout email", async () => {
  const { rows } = await from("purchases", (q) =>
    q.select("*").ilike("checkout_email", "%@%").order("created_at", { ascending: false }).limit(20),
  );
  return `${rows.length} row(s)`;
});
await probe("payments", "admin_payment_mode()", async () => `mode is ${await rpc("admin_payment_mode")}`);

console.log("\nWebhooks");
await probe("webhooks", "webhook_events list", async () => {
  const { rows, count } = await from("webhook_events", (q) =>
    q.select("*", { count: "exact" }).order("received_at", { ascending: false }).range(0, 99),
  );
  return `${rows.length} shown of ${count}`;
});

console.log("\nSwitches");
await probe("switches", "app_flags list", async () => {
  const { rows } = await from("app_flags", (q) => q.select("*").order("key", { ascending: true }));
  const on = rows.filter((r) => r.enabled).map((r) => r.key);
  return `${rows.length} switches, on: ${on.join(", ")}`;
});

console.log("\nNames");
await probe("names", "names list", async () => {
  const { rows } = await from("names", (q) => q.select("*").order("position", { ascending: true }));
  const shown = rows.filter((r) => r.published).length;
  return `${rows.length} names, ${shown} published, first is ${rows[0]?.transliteration}`;
});
await probe("names", "single name", async () => {
  const { rows } = await from("names", (q) => q.select("*").eq("id", "radha").limit(1));
  if (!rows[0]) throw new Error("radha is missing from the library");
  return `${rows[0].transliteration} — ${rows[0].meaning}`;
});

console.log("\nSystem");
await probe("system", "reminder_settings list", async () => {
  const { rows, count } = await from("reminder_settings", (q) =>
    q.select("*", { count: "exact" }).order("updated_at", { ascending: false }).range(0, 49),
  );
  return `${rows.length} shown of ${count}`;
});
await probe("system", "admin_table_counts()", async () => {
  const t = await rpc("admin_table_counts");
  return Object.entries(t)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
});

console.log("\nAnalytics");
await probe("analytics", "admin_analytics()", async () => {
  const a = await rpc("admin_analytics");
  return `${a.synced_users} syncing, ${a.synced_japs} japs, funnel ${a.funnel.accounts}/${a.funnel.started}/${a.funnel.paid}`;
});

console.log("\nAudit");
await probe("audit", "admin_audit read", async () => {
  const { rows } = await from("admin_audit", (q) =>
    q
      .select("id, actor_email, action, subject, before, after, reason, ip, at")
      .order("at", { ascending: false })
      .limit(100),
  );
  return `${rows.length} entr${rows.length === 1 ? "y" : "ies"}`;
});

console.log(results.join("\n"));
console.log(`\n${results.length - failed}/${results.length} reads succeeded`);
process.exit(failed ? 1 : 0);
