/**
 * A restore drill that does not wait for a paid backup plan (docs/DEPLOY.md §7).
 *
 * "A backup that has never been restored is a theory." Supabase Pro's own backups
 * still need a real restore into a scratch project before launch — that is Rajan's.
 * This proves the part the repository owns: that every table's data can be taken
 * out, that the migrations rebuild the schema from nothing, and that the data goes
 * back in and adds up.
 *
 *   1. export every public table from the LIVE project as JSON (Management API,
 *      read-only SELECTs) to .restore-drill/<timestamp>/
 *   2. start an empty Postgres (PGlite) with Supabase's roles and auth.users
 *   3. apply supabase/migrations/* in order
 *   4. load the export — auth users first, then parents before children
 *   5. compare row counts per table and, per user, the sum of their components
 *
 *   node scripts/restore-drill.mjs
 *
 * The export contains personal data (checkout emails). It is written under
 * .restore-drill/, which .gitignore must cover, and should be deleted after the
 * drill. Needs site/.env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_ACCESS_TOKEN.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = join(root, "..");

const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);
const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Management API HTTP ${res.status}`);
  return res.json();
}

/** Parents before children, so foreign keys hold while loading. */
const TABLES = [
  "purchases",
  "payments",
  "webhook_events",
  "entitlements",
  "counter_components",
  "user_settings",
  "push_installations",
  "reminder_settings",
];

// Kept identical to tests/unit/db/harness.ts, where the migrations are proven to
// apply. A thinner copy here would fail on the first migration that needs more.
const SUPABASE_SHAPE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key, email text unique);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  $$;

  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(root, ".restore-drill", stamp);
mkdirSync(out, { recursive: true });

// 1. Export.
const existing = new Set((await sql("select tablename from pg_tables where schemaname = 'public'")).map((r) => r.tablename));
const tables = TABLES.filter((t) => existing.has(t));
const exported = {};
exported["auth.users"] = await sql("select id, email from auth.users");
for (const t of tables) exported[t] = await sql(`select * from public.${t}`);
for (const [name, rows] of Object.entries(exported)) writeFileSync(join(out, `${name}.json`), JSON.stringify(rows));
console.log(`exported ${Object.values(exported).reduce((n, r) => n + r.length, 0)} rows from ${tables.length + 1} tables`);

// 2–3. Rebuild from nothing.
const pg = new PGlite();
await pg.exec(SUPABASE_SHAPE);
const migrations = readdirSync(join(repo, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
for (const m of migrations) await pg.exec(readFileSync(join(repo, "supabase", "migrations", m), "utf8"));
console.log(`applied ${migrations.length} migrations to an empty database`);

// 4. Load. The guards that stop clients moving components back or writing
// far-future days must not refuse restored history, so triggers are off while
// loading — as they are for a real restore.
await pg.exec("set session_replication_role = replica");
for (const u of exported["auth.users"]) await pg.query("insert into auth.users (id, email) values ($1, $2)", [u.id, u.email]);
for (const t of tables) {
  for (const row of exported[t]) {
    const cols = Object.keys(row);
    await pg.query(
      `insert into public.${t} (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
      cols.map((c) => row[c]),
    );
  }
}
await pg.exec("set session_replication_role = origin");

// 5. Compare.
let failures = 0;
for (const t of ["auth.users", ...tables]) {
  const name = t.includes(".") ? t : `public.${t}`;
  const [{ n }] = (await pg.query(`select count(*)::int as n from ${name}`)).rows;
  const ok = n === exported[t].length;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${t}: ${exported[t].length} exported, ${n} restored`);
}

if (tables.includes("counter_components")) {
  const live = await sql("select user_id, sum(count)::bigint as total from public.counter_components group by user_id order by user_id");
  const back = (await pg.query("select user_id, sum(count)::bigint as total from public.counter_components group by user_id order by user_id")).rows;
  const same = JSON.stringify(live.map((r) => [r.user_id, String(r.total)])) === JSON.stringify(back.map((r) => [r.user_id, String(r.total)]));
  if (!same) failures += 1;
  console.log(`${same ? "PASS" : "FAIL"}  every user's total count is identical after restore`);
}

await pg.close();
console.log(`\nexport kept at ${out} — delete it when the drill is done`);
process.exitCode = failures ? 1 : 0;
