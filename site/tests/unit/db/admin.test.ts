import { beforeAll, afterAll, describe, expect, test } from "vitest";

import { codeOf, openDatabase, utcDay, type Db, type Who } from "./harness";

/**
 * The admin migrations, against a real Postgres (docs/ADMIN.md).
 *
 * Two things are being checked, and the second matters more than the first.
 *
 * That the functions work: the dashboard adds up, the reconciliation query finds
 * a paid buyer with no entitlement, the user list filters.
 *
 * And that the guarantees written as constraints actually hold when something
 * tries to break them — a name id being changed, a name being deleted, an audit
 * row being edited, the counter appearing in the kill switches. Those are the
 * promises the panel makes to the product, and a promise nobody tested is a
 * comment.
 */

const A = "00000000-0000-4000-8000-0000000000a1"; // paid, has premium
const B = "00000000-0000-4000-8000-0000000000b1"; // paid, entitlement missing
const C = "00000000-0000-4000-8000-0000000000c1"; // signed up, never paid
const D = "00000000-0000-4000-8000-0000000000d1"; // paid, then deleted their own account

const service: Who = { role: "service_role" };
const anon: Who = { role: "anon" };
const user = (sub: string): Who => ({ role: "authenticated", sub });

let db: Db;

beforeAll(async () => {
  db = await openDatabase();

  await db.admin(
    `insert into auth.users (id, email, email_confirmed_at, created_at) values
       ($1, 'a@test.local', now(), now()),
       ($2, 'b@test.local', now(), now()),
       ($3, 'c@test.local', null,  now())`,
    [A, B, C],
  );

  // Two people paid. Only one of them came out of it with an entitlement.
  await db.admin(
    `insert into public.purchases (order_id, plan_id, expected_amount, expected_currency, mode, checkout_email, state, user_id) values
       ('order_aaaaaa', 'premium_lifetime_v1', 20000, 'INR', 'test', 'a@test.local', 'notified', $1),
       ('order_bbbbbb', 'premium_lifetime_v1', 20000, 'INR', 'test', 'b@test.local', 'captured', $2)`,
    [A, B],
  );
  await db.admin(
    `insert into public.payments (payment_id, order_id, amount, currency, status, mode) values
       ('pay_aaaaaa', 'order_aaaaaa', 20000, 'INR', 'captured', 'test'),
       ('pay_bbbbbb', 'order_bbbbbb', 20000, 'INR', 'captured', 'test')`,
  );
  await db.admin(
    `insert into public.entitlements (user_id, plan_id, mode, status, order_id)
     values ($1, 'premium_lifetime_v1', 'test', 'active', 'order_aaaaaa')`,
    [A],
  );

  await db.admin(
    `insert into public.counter_components (user_id, day, naam_id, source_id, count, rounds)
     values ($1, $2, 'radha', 'phone', 1080, 10), ($1, $2, 'ram', 'phone', 108, 1)`,
    [A, utcDay()],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("the dashboard", () => {
  test("counts accounts, premium, and money actually captured", async () => {
    const [row] = await db.as(service, "select public.admin_overview() as o");
    const o = row.o as Record<string, number | string>;

    expect(o.accounts).toBe(3);
    expect(o.accounts_confirmed).toBe(2);
    expect(o.signups_today).toBe(3);
    expect(o.premium).toBe(1);
    // Both payments captured, whether or not the entitlement followed. Money
    // received is money received.
    expect(o.revenue_paise).toBe(40000);
    expect(o.mode).toBe("test");
  });

  test("finds the buyer who paid and got nothing", async () => {
    const rows = await db.as(service, "select * from public.admin_reconciliation()");
    expect(rows).toHaveLength(1);
    expect(rows[0].checkout_email).toBe("b@test.local");
    expect(rows[0].payment_id).toBe("pay_bbbbbb");
  });

  test("counts that buyer in the overview's alert", async () => {
    const [row] = await db.as(service, "select public.admin_overview() as o");
    expect((row.o as Record<string, number>).unreconciled).toBe(1);
  });

  test("does not count a purchase whose owner deleted their account", async () => {
    // Its own account, so a failed assertion here cannot leave the other tests
    // looking at a database it half cleaned up.
    await db.admin(
      `insert into auth.users (id, email, email_confirmed_at) values ($1, 'd@test.local', now())`,
      [D],
    );
    await db.admin(
      `insert into public.purchases (order_id, plan_id, expected_amount, expected_currency, mode, checkout_email, state, user_id)
       values ('order_dddddd', 'premium_lifetime_v1', 20000, 'INR', 'test', 'd@test.local', 'notified', $1)`,
      [D],
    );
    await db.admin(
      `insert into public.payments (payment_id, order_id, amount, currency, status, mode)
       values ('pay_dddddd', 'order_dddddd', 20000, 'INR', 'captured', 'test')`,
    );

    // Deleting the account sets purchases.user_id to null, so the tombstone can
    // no longer be looked up by id. The purchase's own state is what says this
    // account existed and worked before its owner removed it.
    await db.admin("select public.delete_account($1)", [D]);
    const [gone] = await db.admin("select user_id from public.purchases where order_id = 'order_dddddd'");
    expect(gone.user_id).toBeNull();

    const orders = (await db.as(service, "select order_id from public.admin_reconciliation()")).map(
      (r) => r.order_id,
    );
    expect(orders).not.toContain("order_dddddd");
    // The genuine failure is still reported.
    expect(orders).toContain("order_bbbbbb");
  });

  test("does count a payment that never produced an account at all", async () => {
    // Same shape — no user_id — but the purchase never got past 'captured'. That
    // is money received for nothing, and it must not be filtered out with the
    // deleted accounts.
    await db.admin(
      `insert into public.purchases (order_id, plan_id, expected_amount, expected_currency, mode, checkout_email, state, user_id)
       values ('order_eeeeee', 'premium_lifetime_v1', 20000, 'INR', 'test', 'e@test.local', 'captured', null)`,
    );
    await db.admin(
      `insert into public.payments (payment_id, order_id, amount, currency, status, mode)
       values ('pay_eeeeee', 'order_eeeeee', 20000, 'INR', 'captured', 'test')`,
    );

    const orders = (await db.as(service, "select order_id from public.admin_reconciliation()")).map(
      (r) => r.order_id,
    );
    expect(orders).toContain("order_eeeeee");
  });

  test("a refunded purchase is a decision, not a failure", async () => {
    await db.admin("update public.purchases set state = 'refunded' where order_id = 'order_eeeeee'");
    const orders = (await db.as(service, "select order_id from public.admin_reconciliation()")).map(
      (r) => r.order_id,
    );
    expect(orders).not.toContain("order_eeeeee");
  });
});

describe("the user list", () => {
  test("filters to premium, and reports the unfiltered total", async () => {
    const rows = await db.as(service, "select * from public.admin_users(null, 'premium', 50, 0)");
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("a@test.local");
    expect(Number(rows[0].total_rows)).toBe(1);
    expect(rows[0].premium).toBe(true);
  });

  test("filters to accounts that never confirmed an email", async () => {
    const rows = await db.as(service, "select * from public.admin_users(null, 'unconfirmed', 50, 0)");
    expect(rows.map((r) => r.email)).toEqual(["c@test.local"]);
  });

  test("searches the email as a case-insensitive substring", async () => {
    const rows = await db.as(service, "select * from public.admin_users('A@TEST', 'all', 50, 0)");
    expect(rows.map((r) => r.email)).toEqual(["a@test.local"]);
  });

  test("shows the list rather than failing on a filter it does not know", async () => {
    const rows = await db.as(service, "select * from public.admin_users(null, 'nonsense', 50, 0)");
    expect(rows).toHaveLength(3);
  });

  test("returns one user's detail without any of their counts", async () => {
    const [row] = await db.as(service, "select public.admin_user($1) as u", [A]);
    const u = row.u as Record<string, unknown>;

    expect(u.email).toBe("a@test.local");
    expect(u.premium).toBe(true);
    expect((u.purchases as unknown[]).length).toBe(1);
    // The shape of the practice, never the practice.
    expect((u.sync as Record<string, number>).names).toBe(2);
    expect((u.sync as Record<string, number>).rows).toBe(2);
    expect(JSON.stringify(u)).not.toContain("1080");
  });

  test("returns null for an id that is not an account", async () => {
    const [row] = await db.as(service, "select public.admin_user($1) as u", [
      "00000000-0000-4000-8000-0000000000ff",
    ]);
    expect(row.u).toBeNull();
  });
});

describe("entitlements by hand", () => {
  test("granting reports what was there before, and makes the user premium", async () => {
    const [before] = await db.as(
      service,
      "select public.admin_grant_entitlement($1, 'premium_lifetime_v1', 'order_bbbbbb') as was",
      [B],
    );
    expect(before.was).toBeNull();

    const [row] = await db.as(service, "select public.admin_user($1) as u", [B]);
    expect((row.u as Record<string, unknown>).premium).toBe(true);
  });

  test("revoking leaves the row behind, marked revoked", async () => {
    const [before] = await db.as(
      service,
      "select public.admin_revoke_entitlement($1, 'premium_lifetime_v1') as was",
      [B],
    );
    expect(before.was).toBe("active");

    const rows = await db.admin("select status from public.entitlements where user_id = $1", [B]);
    // Still there. "Never had it" and "we took it away" are different facts.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("revoked");
  });

  test("refuses to grant to an account its owner deleted", async () => {
    await db.admin("insert into private.account_tombstones (user_id) values ($1)", [C]);
    expect(
      await codeOf(
        db.as(service, "select public.admin_grant_entitlement($1, 'premium_lifetime_v1')", [C]),
      ),
    ).toBe("42501");
    await db.admin("delete from private.account_tombstones where user_id = $1", [C]);
  });

  test("a signed-in user cannot call either one", async () => {
    expect(
      await codeOf(
        db.as(user(C), "select public.admin_grant_entitlement($1, 'premium_lifetime_v1')", [C]),
      ),
    ).toBe("42501");
    expect(
      await codeOf(db.as(user(C), "select public.admin_revoke_entitlement($1, 'premium_lifetime_v1')", [C])),
    ).toBe("42501");
  });
});

describe("payment mode", () => {
  test("reads, and reports the mode it replaced", async () => {
    const [now] = await db.as(service, "select public.admin_payment_mode() as m");
    expect(now.m).toBe("test");

    const [changed] = await db.as(service, "select public.admin_set_payment_mode('live') as was");
    expect(changed.was).toBe("test");

    const [after] = await db.as(service, "select public.admin_payment_mode() as m");
    expect(after.m).toBe("live");
  });

  test("premium in the old mode stops counting the moment it changes", async () => {
    // A is premium in test mode only, and the site is now live.
    const [row] = await db.as(service, "select public.admin_user($1) as u", [A]);
    expect((row.u as Record<string, unknown>).premium).toBe(false);

    await db.as(service, "select public.admin_set_payment_mode('test')");
  });

  test("nobody but the server may change it", async () => {
    expect(await codeOf(db.as(user(A), "select public.admin_set_payment_mode('live')"))).toBe("42501");
    expect(await codeOf(db.as(anon, "select public.admin_payment_mode()"))).toBe("42501");
  });
});

describe("the kill switches", () => {
  test("a visitor may read them but not change them", async () => {
    const rows = await db.as(anon, "select key, enabled from public.app_flags order by key");
    expect(rows.length).toBeGreaterThan(0);

    expect(
      await codeOf(db.as(anon, "update public.app_flags set enabled = false where key = 'ads'")),
    ).toBe("42501");
    expect(
      await codeOf(db.as(user(A), "update public.app_flags set enabled = false where key = 'ads'")),
    ).toBe("42501");
  });

  test("the server may turn one off", async () => {
    await db.as(service, "update public.app_flags set enabled = false where key = 'ads'");
    const [row] = await db.as(anon, "select enabled from public.app_flags where key = 'ads'");
    expect(row.enabled).toBe(false);
    await db.as(service, "update public.app_flags set enabled = true where key = 'ads'");
  });

  test("there is no way to add a switch that turns the counter off", async () => {
    // The product's promise: every optional system can be off and the counter
    // still counts. A 'counter' switch must therefore not be creatable at all —
    // not by a future screen, not by hand.
    expect(
      await codeOf(
        db.admin("insert into public.app_flags (key, enabled, note) values ('counter', false, 'no')"),
      ),
    ).toBe("23514");
    expect(
      await codeOf(
        db.admin("insert into public.app_flags (key, enabled, note) values ('anything_else', false, 'no')"),
      ),
    ).toBe("23514");
  });
});

describe("the name library", () => {
  test("ships with the names the counter already offers, in order", async () => {
    const rows = await db.as(anon, "select id from public.names order by position limit 3");
    expect(rows.map((r) => r.id)).toEqual(["radha", "shriradha", "radhe"]);
  });

  test("a visitor sees published names only", async () => {
    await db.as(service, "update public.names set published = false where id = 'radhe'");
    const visible = await db.as(anon, "select id from public.names where id = 'radhe'");
    expect(visible).toHaveLength(0);

    // The panel still sees it, which is what makes unpublishing reversible.
    const toAdmin = await db.as(service, "select id from public.names where id = 'radhe'");
    expect(toAdmin).toHaveLength(1);

    await db.as(service, "update public.names set published = true where id = 'radhe'");
  });

  test("an id cannot be changed: counts are stored under it", async () => {
    expect(
      await codeOf(db.as(service, "update public.names set id = 'radha2' where id = 'radha'")),
    ).toBe("42501");
  });

  test("a name cannot be deleted, by anyone", async () => {
    expect(await codeOf(db.as(service, "delete from public.names where id = 'radha'"))).toBe("42501");
    expect(await codeOf(db.admin("delete from public.names where id = 'radha'"))).toBe("42501");
  });

  test("a visitor cannot write one", async () => {
    expect(
      await codeOf(
        db.as(user(A), "update public.names set transliteration = 'Hacked' where id = 'radha'"),
      ),
    ).toBe("42501");
  });
});

describe("the audit log", () => {
  test("accepts a row from the server and nobody else", async () => {
    await db.as(
      service,
      `insert into public.admin_audit (actor_email, action, subject, after)
       values ('rajan@test.local', 'entitlement.grant', $1, '{"status":"active"}'::jsonb)`,
      [A],
    );
    const rows = await db.as(service, "select action from public.admin_audit");
    expect(rows).toHaveLength(1);

    expect(
      await codeOf(
        db.as(user(A), "insert into public.admin_audit (actor_email, action) values ('x@y.z', 'a.b')"),
      ),
    ).toBe("42501");
    expect(await codeOf(db.as(user(A), "select * from public.admin_audit"))).toBe("42501");
  });

  test("refuses an action name that is not a machine name", async () => {
    expect(
      await codeOf(
        db.as(service, "insert into public.admin_audit (actor_email, action) values ('x@y.z', 'Granted Premium')"),
      ),
    ).toBe("23514");
  });

  test("cannot be rewritten or cleared, even by the superuser", async () => {
    expect(await codeOf(db.admin("update public.admin_audit set action = 'nothing.happened'"))).toBe(
      "42501",
    );
    expect(await codeOf(db.admin("delete from public.admin_audit"))).toBe("42501");
    expect(await codeOf(db.admin("truncate public.admin_audit"))).toBe("42501");

    // And it is all still there.
    const rows = await db.as(service, "select action from public.admin_audit");
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("entitlement.grant");
  });
});

describe("analytics", () => {
  test("adds up only what actually reached the server", async () => {
    const [row] = await db.as(service, "select public.admin_analytics() as a");
    const a = row.a as Record<string, unknown>;

    expect(a.synced_users).toBe(1);
    expect(Number(a.synced_japs)).toBe(1188);
    const top = a.top_names as { naam_id: string; japs: number }[];
    expect(top[0].naam_id).toBe("radha");
    expect(Number(top[0].japs)).toBe(1080);
  });

  test("leaves the reserved id out of the names list, but not out of the total", async () => {
    /*
     * '_day' is what the account link files practice under when it predates the
     * counter tracking names at all (lib/counter/account-link.ts). Those japs
     * are real — they belong in the total — but as a row in "most chanted" it is
     * meaningless, and it linked to a name page that does not exist.
     */
    await db.admin(
      `insert into public.counter_components (user_id, day, naam_id, source_id, count, rounds)
       values ($1, $2, '_day', 'imported', 500, 4)`,
      [A, utcDay(-1)],
    );

    const [row] = await db.as(service, "select public.admin_analytics() as a");
    const a = row.a as Record<string, unknown>;

    const names = (a.top_names as { naam_id: string }[]).map((n) => n.naam_id);
    expect(names).not.toContain("_day");
    expect(names).toContain("radha");

    // Still counted, and reported on its own so the screen can say so.
    expect(Number(a.synced_japs)).toBe(1688);
    expect(Number(a.unnamed_japs)).toBe(500);
  });

  test("counts the tables the system screen shows", async () => {
    const [row] = await db.as(service, "select public.admin_table_counts() as t");
    const t = row.t as Record<string, number>;
    expect(t.names).toBe(45);
    // a, b, and the two the reconciliation tests added.
    expect(t.payments).toBe(4);
  });
});
