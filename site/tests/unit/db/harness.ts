import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

/**
 * A real Postgres, in process, with just enough of Supabase around it to run the
 * migrations exactly as written: the anon / authenticated / service_role roles,
 * auth.users, auth.uid() reading the JWT claims, and Supabase's default grants on
 * the public schema — so the migrations' own revokes are what is being tested.
 *
 * Row-level security is enforced for real. SET ROLE drops the superuser.
 */

const MIGRATIONS = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));

const SUPABASE_SHAPE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  -- The columns the migrations actually read. created_at and email_confirmed_at
  -- arrived with the admin panel's dashboard, which counts signups and confirmed
  -- accounts; banned_until is what Supabase's Admin API sets when an account is
  -- suspended, and the panel displays it. Defaults match Supabase's own.
  create table auth.users (
    id                 uuid primary key,
    email              text unique,
    created_at         timestamptz not null default now(),
    email_confirmed_at timestamptz,
    last_sign_in_at    timestamptz,
    banned_until       timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  $$;

  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- What Supabase does for every new object in public.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type Who =
  | { role: "anon" }
  | { role: "authenticated"; sub: string }
  | { role: "service_role" };

export type Row = Record<string, unknown>;

export type Db = {
  /** Runs one statement as the given role, with matching JWT claims. */
  as: (who: Who, sql: string, params?: unknown[]) => Promise<Row[]>;
  /** Runs as the superuser: seeding and inspection only. */
  admin: (sql: string, params?: unknown[]) => Promise<Row[]>;
  close: () => Promise<void>;
};

export function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(MIGRATIONS + name, "utf8") }));
}

export async function openDatabase(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(SUPABASE_SHAPE);
  for (const { name, sql } of migrationFiles()) {
    try {
      await pg.exec(sql);
    } catch (err) {
      throw new Error(`migration ${name} failed: ${(err as Error).message}`);
    }
  }

  const admin = async (sql: string, params: unknown[] = []) => (await pg.query<Row>(sql, params)).rows;

  const as = async (who: Who, sql: string, params: unknown[] = []) => {
    const claims = who.role === "authenticated" ? { sub: who.sub, role: who.role } : { role: who.role };
    await pg.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
    await pg.exec(`set role ${who.role}`);
    try {
      return (await pg.query<Row>(sql, params)).rows;
    } finally {
      await pg.exec("reset role");
      await pg.query("select set_config('request.jwt.claims', '', false)");
    }
  };

  return { as, admin, close: () => pg.close() };
}

/** The Postgres error code a rejected statement carried. */
export async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return String((err as { code?: string }).code ?? "no-code");
  }
  return "no-error";
}

/** A UTC date string offset from today — the server's clock, which the clamp uses. */
export function utcDay(offsetDays = 0, offsetYears = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + offsetYears);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
