/**
 * Apply a migration to the live Supabase project, the way docs/DEPLOY.md §2 says.
 *
 *   node scripts/apply-migration.mjs --check
 *   node scripts/apply-migration.mjs 20260915120000_admin_audit
 *
 * `supabase link` is refused for this project's access token, so migrations go
 * through the Management API instead. Four things this does that pasting the SQL
 * into a console does not:
 *
 *   1. Refuses to run if that version is already recorded. Running a migration
 *      twice is how a "create table" turns into an outage on a Sunday.
 *   2. Wraps the whole thing in one transaction. A migration that fails half way
 *      leaves nothing behind.
 *   3. Records the version in supabase_migrations.schema_migrations, in the same
 *      transaction, so a later `supabase db push` does not run it again.
 *   4. Prints what is already applied first, so what is about to happen is
 *      visible before it happens.
 *
 * It never prints a key or a token.
 */

import { readFileSync, readdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const DIR = new URL("../../supabase/migrations/", import.meta.url);

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : [];
}

const applied = async () =>
  (await sql("select version from supabase_migrations.schema_migrations order by version")).map(
    (r) => r.version,
  );

const onDisk = () =>
  readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => f.replace(/\.sql$/, ""));

/*
 * The project records a migration by its TIMESTAMP alone — '20260910120000' —
 * not by the file name. Comparing whole file names reported every migration as
 * pending, the four that have been live since Phase 7 included. Had the script
 * gone on to trust that, its first run would have re-applied all of them.
 */
const stamp = (v) => v.match(/^\d+/)[0];

const [arg] = process.argv.slice(2);

if (!arg || arg === "--check") {
  const have = await applied();
  console.log("applied on the project:");
  for (const v of have) console.log(`  ${v}`);
  console.log("\nin supabase/migrations/:");
  for (const v of onDisk()) console.log(`  ${have.includes(stamp(v)) ? "applied " : "PENDING "} ${v}`);
  process.exit(0);
}

const version = arg.replace(/\.sql$/, "");
const name = version.replace(/^\d+_/, "");

if (!onDisk().includes(version)) {
  console.error(`No such migration: ${version}`);
  process.exit(1);
}
if ((await applied()).includes(stamp(version))) {
  console.error(`${version} is already applied. Nothing to do.`);
  process.exit(1);
}

const body = readFileSync(new URL(`${version}.sql`, DIR), "utf8");

/* One transaction: the migration and its own bookkeeping, or neither. The
   statements array is what `supabase db push` compares against later. */
const wrapped = `
begin;
${body}
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('${stamp(version)}', '${name}', array[$stmt$${body}$stmt$]);
commit;
`;

console.log(`applying ${version} …`);
await sql(wrapped);

const have = await applied();
if (!have.includes(stamp(version))) {
  console.error(`${version} did not record itself. Check the project before doing anything else.`);
  process.exit(1);
}
console.log(`${version} applied and recorded.`);
