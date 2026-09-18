import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { codeOf, openDatabase, utcDay, type Db, type Who } from "./harness";

/**
 * The isolation matrix (ARCHITECTURE §6, Phase 7).
 *
 * RLS failures come back as empty results, not errors, so every "cannot see"
 * assertion here is on the rows themselves (SECURITY §2). Every "cannot write" is
 * on the Postgres error code:
 *
 *   42501  insufficient privilege — no grant, a policy's WITH CHECK, or a guard
 *   23514  a CHECK constraint
 *   22008  a day outside the clock clamp
 *   54000  too many sources
 */

const A = "00000000-0000-4000-8000-00000000000a"; // premium
const B = "00000000-0000-4000-8000-00000000000b"; // premium
const C = "00000000-0000-4000-8000-00000000000c"; // signed in, never paid

const user = (sub: string): Who => ({ role: "authenticated", sub });
const anon: Who = { role: "anon" };
const service: Who = { role: "service_role" };

const PUBLIC_TABLES = [
  "purchases",
  "payments",
  "webhook_events",
  "entitlements",
  "counter_components",
  "user_settings",
  "push_installations",
  "reminder_settings",
];

let db: Db;

async function addUser(id: string, premium: boolean) {
  await db.admin("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-1)}@test.local`]);
  if (premium) {
    await db.admin(
      "insert into public.entitlements (user_id, plan_id, mode, status) values ($1, 'premium_lifetime_v1', 'test', 'active')",
      [id],
    );
  }
}

const upsertComponent = (who: Who, row: { user: string; day?: string; naam?: string; source?: string; count: number; rounds?: number }) =>
  db.as(
    who,
    `insert into public.counter_components (user_id, day, naam_id, source_id, count, rounds)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, day, naam_id, source_id)
       do update set count = greatest(counter_components.count, excluded.count),
                     rounds = greatest(counter_components.rounds, excluded.rounds)
     returning count, rounds`,
    [row.user, row.day ?? utcDay(), row.naam ?? "ram", row.source ?? "phone", row.count, row.rounds ?? 0],
  );

beforeAll(async () => {
  db = await openDatabase();
  await addUser(A, true);
  await addUser(B, true);
  await addUser(C, false);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("the rules every table follows", () => {
  test("every table has row level security on", async () => {
    const open = await db.admin(`
      select n.nspname || '.' || c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public', 'private') and not c.relrowsecurity`);
    expect(open).toEqual([]);
  });

  test("every policy a user can write through has both USING and WITH CHECK", async () => {
    const halfPolicies = await db.admin(`
      select tablename, policyname from pg_policies
      where schemaname = 'public' and cmd in ('UPDATE', 'ALL')
        and (qual is null or with_check is null)`);
    expect(halfPolicies).toEqual([]);
  });

  test("every SECURITY DEFINER function pins its search_path", async () => {
    const unpinned = await db.admin(`
      select n.nspname || '.' || p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'private')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s like 'search_path=%')`);
    expect(unpinned).toEqual([]);
  });

  test.each(PUBLIC_TABLES)("anon can neither read nor write %s", async (table) => {
    expect(await codeOf(db.as(anon, `select * from public.${table}`))).toBe("42501");
    expect(await codeOf(db.as(anon, `delete from public.${table}`))).toBe("42501");
  });

  test("the private schema is out of reach of signed-in users", async () => {
    expect(await codeOf(db.as(user(A), "select * from private.account_tombstones"))).toBe("42501");
    expect(await codeOf(db.as(user(A), "update private.app_config set payment_mode = 'test'"))).toBe("42501");
  });
});

describe("counter_components", () => {
  const day = utcDay(-1);

  beforeAll(async () => {
    await upsertComponent(user(A), { user: A, day, count: 40 });
    await upsertComponent(user(B), { user: B, day, count: 7 });
  });

  test("a user sees their own rows and nobody else's", async () => {
    const mine = await db.as(user(A), "select user_id, count from public.counter_components where day = $1", [day]);
    expect(mine).toEqual([{ user_id: A, count: 40 }]);

    const theirs = await db.as(user(B), "select * from public.counter_components where user_id = $1", [A]);
    expect(theirs).toEqual([]);
  });

  test("a user cannot write a row for someone else", async () => {
    expect(await codeOf(upsertComponent(user(B), { user: A, day, source: "b-forged", count: 999 }))).toBe("42501");
  });

  test("a user cannot change someone else's row", async () => {
    const touched = await db.as(
      user(B),
      "update public.counter_components set count = 999 where user_id = $1 returning *",
      [A],
    );
    expect(touched).toEqual([]);
    const [row] = await db.admin("select count from public.counter_components where user_id = $1 and day = $2", [A, day]);
    expect(row.count).toBe(40);
  });

  test("a user cannot move their own row onto someone else", async () => {
    expect(
      await codeOf(db.as(user(A), "update public.counter_components set user_id = $1 where user_id = $2", [B, A])),
    ).toBe("42501");
  });

  test("nobody deletes history, not even their own", async () => {
    expect(await codeOf(db.as(user(A), "delete from public.counter_components where user_id = $1", [A]))).toBe("42501");
  });

  test("a signed-in user without premium cannot sync", async () => {
    expect(await codeOf(upsertComponent(user(C), { user: C, day, count: 5 }))).toBe("42501");
  });

  test("a component never goes down", async () => {
    const d = utcDay(-2);
    await upsertComponent(user(A), { user: A, day: d, count: 50, rounds: 0 });

    // A stale device's plain update, and a stale upsert, both keep the higher value.
    await db.as(user(A), "update public.counter_components set count = 10 where user_id = $1 and day = $2", [A, d]);
    expect(await upsertComponent(user(A), { user: A, day: d, count: 20 })).toEqual([{ count: 50, rounds: 0 }]);

    // A newer value goes through.
    expect(await upsertComponent(user(A), { user: A, day: d, count: 120, rounds: 1 })).toEqual([{ count: 120, rounds: 1 }]);
  });

  test("the clock clamp: one day ahead is fine, two is refused", async () => {
    expect(await codeOf(upsertComponent(user(A), { user: A, day: utcDay(1), count: 1 }))).toBe("no-error");
    expect(await codeOf(upsertComponent(user(A), { user: A, day: utcDay(2), count: 1 }))).toBe("22008");
  });

  test("the clock clamp: nothing more than five years back", async () => {
    expect(await codeOf(upsertComponent(user(A), { user: A, day: utcDay(2, -5), count: 1 }))).toBe("no-error");
    expect(await codeOf(upsertComponent(user(A), { user: A, day: utcDay(-2, -5), count: 1 }))).toBe("22008");
  });

  test("at most 20 sources per user, day and name", async () => {
    const d = utcDay(-3);
    for (let i = 1; i <= 20; i++) {
      await upsertComponent(user(A), { user: A, day: d, naam: "krishna", source: `device-${i}`, count: i });
    }
    expect(await codeOf(upsertComponent(user(A), { user: A, day: d, naam: "krishna", source: "device-21", count: 1 }))).toBe("54000");
    // An existing source keeps syncing at the cap.
    expect(await upsertComponent(user(A), { user: A, day: d, naam: "krishna", source: "device-20", count: 30 })).toEqual([
      { count: 30, rounds: 0 },
    ]);
    // Another name on the same day has its own allowance.
    expect(await codeOf(upsertComponent(user(A), { user: A, day: d, naam: "shiva", source: "device-21", count: 1 }))).toBe("no-error");
  });

  test("the limits in SPEC §7 hold", async () => {
    const d = utcDay(-4);
    expect(await codeOf(upsertComponent(user(A), { user: A, day: d, count: -1 }))).toBe("23514");
    expect(await codeOf(upsertComponent(user(A), { user: A, day: d, count: 10_000_001 }))).toBe("23514");
    expect(await codeOf(upsertComponent(user(A), { user: A, day: d, naam: "n".repeat(121), count: 1 }))).toBe("23514");
    expect(await codeOf(upsertComponent(user(A), { user: A, day: d, source: "rounds", count: 1, rounds: 2 }))).toBe("23514");
  });
});

describe("time on the mala (migration 3: per name, on the component)", () => {
  const day = utcDay(-6);
  const upsertTime = (who: Who, uid: string, ms: number, d = day) =>
    db.as(
      who,
      `insert into public.counter_components (user_id, day, naam_id, source_id, count, ms)
       values ($1, $2, 'ram', 'phone', 1, $3)
       on conflict (user_id, day, naam_id, source_id) do update set ms = excluded.ms
       returning ms`,
      [uid, d, ms],
    );

  test("the old per-day timer table is gone", async () => {
    expect(await db.admin("select to_regclass('public.timer_components') as t")).toEqual([{ t: null }]);
  });

  test("private, monotonic, premium only, and within a day", async () => {
    expect(await upsertTime(user(A), A, 60_000)).toEqual([{ ms: 60_000 }]);
    expect(await db.as(user(B), "select ms from public.counter_components where user_id = $1 and day = $2", [A, day])).toEqual([]);
    expect(await codeOf(upsertTime(user(B), A, 1))).toBe("42501");
    // A plain overwrite with less time keeps the higher value: the guard, not the query.
    expect(await upsertTime(user(A), A, 1_000)).toEqual([{ ms: 60_000 }]);
    expect(await codeOf(upsertTime(user(C), C, 1_000))).toBe("42501");
    expect(await codeOf(upsertTime(user(A), A, 86_400_001, utcDay(-7)))).toBe("23514");
  });
});

describe("sync_others", () => {
  const day = utcDay(-8);
  const put = (source: string, naam: string, count: number, rounds: number, ms: number) =>
    db.as(
      user(A),
      `insert into public.counter_components (user_id, day, naam_id, source_id, count, rounds, ms)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [A, day, naam, source, count, rounds, ms],
    );

  beforeAll(async () => {
    await put("phone", "ram", 100, 0, 1_000);
    await put("laptop", "ram", 40, 0, 2_000);
    await put("tablet", "ram", 10, 0, 500);
    await put("local-history", "ram", 90, 0, 900);
    await put("laptop", "shiva", 7, 0, 0);
  });

  test("returns everyone but the caller's own device, with shared history kept apart", async () => {
    const rows = await db.as(
      user(A),
      "select day::text as day, naam_id, kind, count, rounds, ms from public.sync_others('phone', array[$1::date])",
      [day],
    );
    expect(rows).toEqual([
      { day, naam_id: "ram", kind: "devices", count: 50, rounds: 0, ms: 2500 },
      { day, naam_id: "ram", kind: "history", count: 90, rounds: 0, ms: 900 },
      { day, naam_id: "shiva", kind: "devices", count: 7, rounds: 0, ms: 0 },
    ]);
  });

  test("sees only the caller's own rows, and is closed to anon", async () => {
    expect(await db.as(user(B), "select * from public.sync_others('phone', array[$1::date])", [day])).toEqual([]);
    expect(await codeOf(db.as(anon, "select * from public.sync_others('phone')"))).toBe("42501");
  });
});

describe("user_settings", () => {
  test("private, premium only, cannot be moved, and the server owns the version", async () => {
    await db.as(user(A), "insert into public.user_settings (user_id, settings) values ($1, $2)", [A, { target: 108 }]);
    expect(await db.as(user(B), "select * from public.user_settings where user_id = $1", [A])).toEqual([]);
    expect(await codeOf(db.as(user(B), "insert into public.user_settings (user_id, settings) values ($1, '{}')", [A]))).toBe("42501");
    expect(await db.as(user(B), "update public.user_settings set settings = '{}' where user_id = $1 returning *", [A])).toEqual([]);
    expect(await codeOf(db.as(user(A), "update public.user_settings set user_id = $1 where user_id = $2", [B, A]))).toBe("42501");
    expect(await codeOf(db.as(user(C), "insert into public.user_settings (user_id, settings) values ($1, '{}')", [C]))).toBe("42501");
    expect(await codeOf(db.as(user(A), "update public.user_settings set settings = '[]' where user_id = $1", [A]))).toBe("23514");

    const [row] = await db.as(
      user(A),
      "update public.user_settings set settings = $2, version = 1 where user_id = $1 returning version",
      [A, { target: 21 }],
    );
    expect(row.version).toBe(2);
  });
});

describe("payments are the server's alone", () => {
  beforeAll(async () => {
    for (const [uid, order] of [
      [A, "order_AAAAAAAA"],
      [B, "order_BBBBBBBB"],
    ]) {
      await db.as(
        service,
        `insert into public.purchases (order_id, plan_id, expected_amount, expected_currency, mode, checkout_email, user_id)
         values ($1, 'premium_lifetime_v1', 20000, 'INR', 'test', $2, $3)`,
        [order, `${uid.slice(-1)}@test.local`, uid],
      );
    }
    await db.as(
      service,
      "insert into public.payments (payment_id, order_id, amount, currency, status, mode) values ('pay_AAAAAAAA', 'order_AAAAAAAA', 20000, 'INR', 'captured', 'test')",
    );
    await db.as(service, "insert into public.webhook_events (event_id, event_type, mode) values ('evt_1', 'payment.captured', 'test')");
  });

  test("a buyer sees their own purchase and nobody else's", async () => {
    const mine = await db.as(user(A), "select order_id from public.purchases");
    expect(mine).toEqual([{ order_id: "order_AAAAAAAA" }]);
  });

  test("a buyer cannot create, change or delete a purchase", async () => {
    expect(
      await codeOf(
        db.as(
          user(A),
          `insert into public.purchases (order_id, plan_id, expected_amount, expected_currency, mode, checkout_email, user_id)
           values ('order_FORGED01', 'premium_lifetime_v1', 1, 'INR', 'live', 'a@test.local', $1)`,
          [A],
        ),
      ),
    ).toBe("42501");
    expect(await codeOf(db.as(user(A), "update public.purchases set state = 'entitlement_active'"))).toBe("42501");
    expect(await codeOf(db.as(user(A), "delete from public.purchases"))).toBe("42501");
  });

  test("payments and webhook events are invisible to signed-in users", async () => {
    expect(await codeOf(db.as(user(A), "select * from public.payments"))).toBe("42501");
    expect(await codeOf(db.as(user(A), "select * from public.webhook_events"))).toBe("42501");
    expect(await codeOf(db.as(user(A), "insert into public.webhook_events (event_id, event_type, mode) values ('x', 'y', 'test')"))).toBe(
      "42501",
    );
  });

  test("nobody can grant themselves premium", async () => {
    expect(
      await codeOf(
        db.as(
          user(C),
          "insert into public.entitlements (user_id, plan_id, mode, status) values ($1, 'premium_lifetime_v1', 'test', 'active')",
          [C],
        ),
      ),
    ).toBe("42501");
    expect(await codeOf(db.as(user(A), "update public.entitlements set status = 'active'"))).toBe("42501");
    expect(await db.as(user(A), "select user_id from public.entitlements")).toEqual([{ user_id: A }]);
  });

  test("my_premium answers for the caller only", async () => {
    expect(await db.as(user(A), "select public.my_premium() as p")).toEqual([{ p: true }]);
    expect(await db.as(user(C), "select public.my_premium() as p")).toEqual([{ p: false }]);
    expect(await codeOf(db.as(anon, "select public.my_premium()"))).toBe("42501");
  });

  test("the price and the email are shaped at the door", async () => {
    const insert = (amount: number, email: string) =>
      db.as(
        service,
        `insert into public.purchases (order_id, plan_id, expected_amount, expected_currency, mode, checkout_email)
         values ('order_' || substr(md5(random()::text), 1, 12), 'premium_lifetime_v1', $1, 'INR', 'test', $2)`,
        [amount, email],
      );
    expect(await codeOf(insert(0, "x@test.local"))).toBe("23514");
    expect(await codeOf(insert(20000, "Mixed@Test.Local"))).toBe("23514");
    expect(await codeOf(insert(20000, "no-at-sign"))).toBe("23514");
  });
});

describe("test-mode purchases never grant live premium", () => {
  test("switching the site to live mode withdraws every test entitlement at once", async () => {
    await db.admin("update private.app_config set payment_mode = 'live'");
    try {
      expect(await db.as(user(A), "select public.my_premium() as p")).toEqual([{ p: false }]);
      expect(await codeOf(upsertComponent(user(A), { user: A, day: utcDay(-5), source: "live-check", count: 1 }))).toBe("42501");
    } finally {
      await db.admin("update private.app_config set payment_mode = 'test'");
    }
    expect(await db.as(user(A), "select public.my_premium() as p")).toEqual([{ p: true }]);
  });
});

describe("deleting an account", () => {
  const D = "00000000-0000-4000-8000-00000000000d";

  beforeAll(async () => {
    await addUser(D, true);
    await upsertComponent(user(D), { user: D, day: utcDay(-1), count: 11 });
    await db.as(
      service,
      `insert into public.purchases (order_id, plan_id, expected_amount, expected_currency, mode, checkout_email, user_id)
       values ('order_DDDDDDDD', 'premium_lifetime_v1', 20000, 'INR', 'test', 'd@test.local', $1)`,
      [D],
    );
  });

  test("only the server can do it", async () => {
    expect(await codeOf(db.as(user(D), "select public.delete_account($1)", [D]))).toBe("42501");
    expect(await codeOf(db.as(user(A), "select public.delete_account($1)", [D]))).toBe("42501");
  });

  test("it removes the data, keeps the payment record, and cannot be undone by a late sync", async () => {
    await db.as(service, "select public.delete_account($1)", [D]);

    expect(await db.admin("select * from public.counter_components where user_id = $1", [D])).toEqual([]);
    expect(await db.admin("select * from public.entitlements where user_id = $1", [D])).toEqual([]);
    expect(await db.admin("select user_id from public.purchases where order_id = 'order_DDDDDDDD'")).toEqual([{ user_id: null }]);
    expect(await db.admin("select user_id from private.account_tombstones")).toEqual([{ user_id: D }]);

    // The same id comes back — a late webhook, an old phone — and writes nothing.
    await db.admin("insert into auth.users (id, email) values ($1, 'd@test.local')", [D]);
    expect(await codeOf(upsertComponent(service, { user: D, day: utcDay(-1), count: 11 }))).toBe("42501");
  });
});

describe("purchases move forward only (Phase 9)", () => {
  const E = "00000000-0000-4000-8000-00000000000e";
  const ORDER = "order_GUARD0001";

  beforeAll(async () => {
    await addUser(E, false);
    await db.as(
      service,
      `insert into public.purchases (order_id, plan_id, expected_amount, expected_currency, mode, checkout_email)
       values ($1, 'premium_lifetime_v1', 20000, 'INR', 'test', 'e@test.local')`,
      [ORDER],
    );
  });

  const setState = (state: string, extra = "") =>
    db.as(service, `update public.purchases set state = $1 ${extra} where order_id = $2`, [state, ORDER]);

  test("what was ordered cannot be rewritten, even by the server", async () => {
    expect(await codeOf(db.as(service, "update public.purchases set expected_amount = 100 where order_id = $1", [ORDER]))).toBe("42501");
    expect(await codeOf(db.as(service, "update public.purchases set mode = 'live' where order_id = $1", [ORDER]))).toBe("42501");
    expect(await codeOf(db.as(service, "update public.purchases set checkout_email = 'x@test.local' where order_id = $1", [ORDER]))).toBe("42501");
  });

  test("state moves forward, never back", async () => {
    expect(await codeOf(setState("captured"))).toBe("no-error");
    expect(await codeOf(setState("payment_verified"))).toBe("42501");
    expect(await codeOf(setState("failed_recoverable"))).toBe("no-error");
    expect(await codeOf(setState("user_created", `, user_id = '${E}'`))).toBe("no-error");
  });

  test("a purchase stays with the buyer it was attached to", async () => {
    expect(await codeOf(db.as(service, "update public.purchases set user_id = $1 where order_id = $2", [A, ORDER]))).toBe("42501");
  });

  test("refunded is final", async () => {
    expect(await codeOf(setState("refunded"))).toBe("no-error");
    expect(await codeOf(setState("notified"))).toBe("42501");
    expect(await codeOf(setState("revoked"))).toBe("no-error");
  });
});

describe("find_user_id_by_email (Phase 9)", () => {
  test("finds an account for the server, case-insensitively", async () => {
    expect(await db.as(service, "select public.find_user_id_by_email('A@TEST.LOCAL') as id")).toEqual([{ id: A }]);
    expect(await db.as(service, "select public.find_user_id_by_email('nobody@test.local') as id")).toEqual([{ id: null }]);
  });

  test("is closed to signed-in users and to anon — no probing who has bought", async () => {
    expect(await codeOf(db.as(user(A), "select public.find_user_id_by_email('b@test.local')"))).toBe("42501");
    expect(await codeOf(db.as(anon, "select public.find_user_id_by_email('b@test.local')"))).toBe("42501");
  });
});

describe("push_installations (migration 4)", () => {
  const SHARED_TOKEN = `fcm-shared-${"x".repeat(24)}`;

  test("written only through claim_push_token, premium only, and the token is never readable", async () => {
    expect(await codeOf(db.as(user(C), "select public.claim_push_token('laptop', $1)", [SHARED_TOKEN]))).toBe("42501");
    expect(await codeOf(db.as(anon, "select public.claim_push_token('laptop', $1)", [SHARED_TOKEN]))).toBe("42501");

    await db.as(user(A), "select public.claim_push_token('phone', $1)", [SHARED_TOKEN]);
    expect(await db.as(user(A), "select user_id, source_id from public.push_installations")).toEqual([
      { user_id: A, source_id: "phone" },
    ]);
    // Their own row, and still not the token.
    expect(await codeOf(db.as(user(A), "select token from public.push_installations"))).toBe("42501");
    // No direct writes, even of their own row.
    expect(
      await codeOf(
        db.as(user(A), "insert into public.push_installations (user_id, source_id, token) values ($1, 'x', $2)", [
          A,
          "y".repeat(30),
        ]),
      ),
    ).toBe("42501");
    expect(await db.as(user(B), "select source_id from public.push_installations")).toEqual([]);
  });

  test("a token claimed by another account on a shared browser leaves the first account", async () => {
    await db.as(user(B), "select public.claim_push_token('shared-browser', $1)", [SHARED_TOKEN]);
    expect(await db.admin("select user_id, source_id from public.push_installations where token = $1", [SHARED_TOKEN])).toEqual([
      { user_id: B, source_id: "shared-browser" },
    ]);
  });

  test("a user removes their own device and nobody else's", async () => {
    await db.as(user(A), "select public.claim_push_token('tablet', $1)", [`fcm-tablet-${"z".repeat(24)}`]);
    await db.as(user(B), "delete from public.push_installations where source_id = 'tablet'");
    expect(await db.admin("select source_id from public.push_installations where source_id = 'tablet'")).toHaveLength(1);
    await db.as(user(A), "delete from public.push_installations where source_id = 'tablet'");
    expect(await db.admin("select source_id from public.push_installations where source_id = 'tablet'")).toHaveLength(0);
  });
});

describe("reminder_settings (migration 4)", () => {
  test("own row only, premium to create, a real zone, and the sent day is the server's", async () => {
    await db.as(
      user(A),
      "insert into public.reminder_settings (user_id, enabled, zone, remind_at) values ($1, true, 'Asia/Kolkata', 1260)",
      [A],
    );
    expect(await db.as(user(B), "select * from public.reminder_settings where user_id = $1", [A])).toEqual([]);
    expect(await codeOf(db.as(user(C), "insert into public.reminder_settings (user_id, enabled) values ($1, true)", [C]))).toBe(
      "42501",
    );
    expect(
      await codeOf(db.as(user(A), "update public.reminder_settings set zone = 'Mars/Olympus_Mons' where user_id = $1", [A])),
    ).toBe("22023");
    expect(await codeOf(db.as(user(A), "update public.reminder_settings set remind_at = 1440 where user_id = $1", [A]))).toBe(
      "23514",
    );
    expect(
      await codeOf(db.as(user(A), "update public.reminder_settings set last_sent_day = current_date where user_id = $1", [A])),
    ).toBe("42501");
  });

  test("reminder_candidates is the scheduler's alone", async () => {
    await db.as(user(A), "select public.claim_push_token('desk', $1)", [`fcm-desk-${"q".repeat(24)}`]);
    expect(await codeOf(db.as(user(A), "select * from public.reminder_candidates()"))).toBe("42501");
    expect(await codeOf(db.as(anon, "select * from public.reminder_candidates()"))).toBe("42501");
    expect(await db.as(service, "select user_id from public.reminder_candidates()")).toContainEqual({ user_id: A });
  });
});
