/**
 * The row-level security isolation matrix, against the LIVE Supabase project,
 * through real Supabase Auth and the REST API.
 *
 * tests/unit/db/rls.test.ts proves the migrations in an in-process Postgres on
 * every `npm run check`. This proves the same rules hold where they actually run:
 * Supabase's own roles, JWTs and PostgREST. Run it after applying a migration.
 *
 *   npm run verify:rls:remote
 *
 * It creates two temporary users (one given a test-mode entitlement), runs the
 * checks, and in `finally` deletes both through public.delete_account — the real
 * deletion path — then removes the tombstones that leaves and confirms nothing is
 * left behind. It never prints a key, token or password.
 *
 * Needs site/.env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ACCESS_TOKEN (Management API, used only
 * to clean up tombstones and count leftovers).
 */

import { randomBytes } from "node:crypto";
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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const REF = new URL(SUPABASE_URL).hostname.split(".")[0];

/** Read-only-in-spirit SQL through the Management API; used here for cleanup. */
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API HTTP ${res.status}`);
  return JSON.parse(text);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, opts);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);

const tag = randomBytes(4).toString("hex");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });
const code = (r) => r.error?.code ?? (r.error ? "error" : "ok");
const utcDay = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const created = [];

async function makeUser(label) {
  const email = `rls-probe-${tag}-${label}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`creating probe user ${label}: ${error.message}`);
  created.push(data.user.id);
  const client = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signing in probe user ${label}: ${signIn.error.message}`);
  return { id: data.user.id, client };
}

try {
  const A = await makeUser("a"); // premium
  const B = await makeUser("b"); // signed in, never paid

  const grant = await admin
    .from("entitlements")
    .insert({ user_id: A.id, plan_id: "premium_lifetime_v1", mode: "test", status: "active" });
  check("service role can grant an entitlement", !grant.error, grant.error?.message);

  const up = (c, row) =>
    c.from("counter_components").upsert(row, { onConflict: "user_id,day,naam_id,source_id" }).select("count");
  const row = (uid, extra) => ({ user_id: uid, day: utcDay(0), naam_id: "ram", source_id: "probe", ...extra });

  let r = await up(A.client, row(A.id, { count: 5 }));
  check("A (premium) writes their own component", code(r) === "ok" && r.data?.[0]?.count === 5, code(r));

  r = await A.client.from("counter_components").update({ count: 1 }).eq("user_id", A.id).select("count");
  check("A lowering a component keeps the higher value", r.data?.[0]?.count === 5, JSON.stringify(r.data));

  r = await B.client.from("counter_components").select("*").eq("user_id", A.id);
  check("B sees none of A's rows (empty, not an error)", code(r) === "ok" && r.data?.length === 0, code(r));

  r = await up(B.client, row(A.id, { source_id: "forged", count: 999 }));
  check("B cannot write a row for A", code(r) === "42501", code(r));

  r = await B.client.from("counter_components").update({ count: 999 }).eq("user_id", A.id).select();
  check("B cannot change A's row", code(r) === "ok" && r.data?.length === 0, code(r));

  r = await up(B.client, row(B.id, { count: 1 }));
  check("B without premium cannot sync", code(r) === "42501", code(r));

  r = await A.client.from("counter_components").delete().eq("user_id", A.id);
  check("A cannot delete history", code(r) === "42501", code(r));

  r = await up(A.client, row(A.id, { day: utcDay(2), count: 1 }));
  check("a day two days ahead is refused (clock clamp)", code(r) === "22008", code(r));

  r = await anon.from("counter_components").select("*");
  check("anon cannot read components", code(r) === "42501", code(r));

  r = await A.client
    .from("entitlements")
    .insert({ user_id: B.id, plan_id: "premium_lifetime_v1", mode: "test", status: "active" });
  check("nobody can grant premium from the client", code(r) === "42501", code(r));

  r = await A.client.rpc("my_premium");
  check("my_premium is true for A", r.data === true, code(r));
  r = await B.client.rpc("my_premium");
  check("my_premium is false for B", r.data === false, code(r));

  r = await A.client.from("payments").select("*");
  check("payments are invisible to signed-in users", code(r) === "42501", code(r));

  r = await A.client.rpc("delete_account", { target: B.id });
  check("a user cannot delete an account", code(r) === "42501", code(r));

  r = await A.client.from("user_settings").insert({ user_id: A.id, settings: { target: 108 } }).select("version");
  check("A writes their own settings", code(r) === "ok" && r.data?.[0]?.version === 1, code(r));
  r = await B.client.from("user_settings").select("*").eq("user_id", A.id);
  check("B cannot read A's settings", code(r) === "ok" && r.data?.length === 0, code(r));
} catch (err) {
  check("script ran to the end", false, err.message);
} finally {
  for (const [i, id] of created.entries()) {
    const del = await admin.rpc("delete_account", { target: id });
    check(`service role deletes probe user ${i + 1}`, !del.error, del.error?.message);
  }
  if (created.length) {
    // The ids come from Supabase Auth, not from input, and are uuids.
    const ids = created.filter((id) => /^[0-9a-f-]{36}$/.test(id)).map((id) => `'${id}'`).join(",");
    await sql(`delete from private.account_tombstones where user_id in (${ids});`);
    const [left] = await sql(`
      select
        (select count(*) from auth.users where id in (${ids})) as users,
        (select count(*) from auth.users where email like 'rls-probe-%') as probe_emails,
        (select count(*) from public.counter_components where user_id in (${ids})) as components,
        (select count(*) from public.user_settings where user_id in (${ids})) as settings,
        (select count(*) from public.entitlements where user_id in (${ids})) as entitlements,
        (select count(*) from private.account_tombstones where user_id in (${ids})) as tombstones;`);
    check("nothing left behind", Object.values(left).every((v) => Number(v) === 0), JSON.stringify(left));
  }

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  [${r.detail}]`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
