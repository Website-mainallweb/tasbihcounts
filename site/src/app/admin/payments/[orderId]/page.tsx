import type { Metadata } from "next";
import Link from "next/link";

import { rerun, restoreTo } from "./actions";
import { requireAdmin } from "@/lib/admin";
import { getPurchase } from "@/lib/admin/db";
import { money, when } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Purchase" };

type Props = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ m?: string }>;
};

/** States where re-running can still achieve something. */
const FINISHED = new Set(["notified", "refunded", "revoked"]);

/**
 * One purchase, end to end (docs/ADMIN.md §3.4).
 *
 * The question this page answers is always the same: the buyer says they paid
 * and Premium is not showing — where did it stop? So the three facts are next to
 * each other: what we asked for, what Razorpay reported, and whether the
 * entitlement exists.
 */
export default async function PurchasePage({ params, searchParams }: Props) {
  await requireAdmin();
  const { orderId } = await params;
  const { m } = await searchParams;

  const record = await getPurchase(orderId);

  if (!record) {
    return (
      <>
        <div className="wrap">
          <Link className="back" href="/admin/payments/">
            ← Payments
          </Link>
          <h1>No such purchase</h1>
          <p className="note">Nothing in this database has that order id.</p>
        </div>
      </>
    );
  }

  const { purchase: p, payments, entitlements } = record;
  const captured = payments.filter((x) => x.status === "captured");
  const active = entitlements.filter((e) => e.status === "active");

  // The account column has three meanings, and the difference matters: a
  // deleted account is somebody's own decision, a missing one is a bug.
  const account = p.user_id
    ? "exists"
    : p.state === "notified" || p.state === "entitlement_active"
      ? "deleted by its owner"
      : "never created";

  return (
    <>
      <div className="wrap">
        <Link className="back" href="/admin/payments/">
          ← Payments
        </Link>
        <p className="eyebrow">{p.mode} mode</p>
        <h1>{p.order_id}</h1>

        <div aria-live="polite">{m && <p className="banner">{m}</p>}</div>

        {captured.length > 0 && active.length === 0 && (
          <p className="error">
            Money was captured and there is no active entitlement. This buyer paid and does not have
            what they paid for.
          </p>
        )}

        <section className="card">
          <h2>What we asked for</h2>
          <dl className="facts">
            <div>
              <dt>Checkout email</dt>
              <dd>{p.checkout_email}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{p.plan_id}</dd>
            </div>
            <div>
              <dt>Amount expected</dt>
              <dd>{money(p.expected_amount, p.expected_currency)}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{p.state.replace(/_/g, " ")}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{when(p.created_at)}</dd>
            </div>
            <div>
              <dt>Last change</dt>
              <dd>{when(p.updated_at)}</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>
                {p.user_id ? <Link href={`/admin/users/${p.user_id}/`}>{account}</Link> : account}
              </dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2>What Razorpay reported</h2>
          {payments.length === 0 ? (
            <p className="note">
              No payment against this order. Usually an abandoned checkout — the buyer opened it and
              did not pay.
            </p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Payment</th>
                    <th scope="col">Status</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Method</th>
                    <th scope="col">Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((x) => (
                    <tr key={x.payment_id}>
                      <td>{x.payment_id}</td>
                      <td>
                        <span className={`pill ${x.status === "captured" ? "pill-good" : x.status === "failed" ? "pill-bad" : ""}`}>
                          {x.status}
                        </span>
                      </td>
                      <td>{money(x.amount, x.currency)}</td>
                      <td>{x.method ?? "—"}</td>
                      <td>{when(x.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Entitlement</h2>
          {entitlements.length === 0 ? (
            <p className="note">
              {p.user_id ? "That account has no entitlement." : "No account to hold one."}
            </p>
          ) : (
            <ul className="plain">
              {entitlements.map((e) => (
                <li key={`${e.plan_id}-${e.mode}`}>
                  <span className={`pill ${e.status === "active" ? "pill-good" : "pill-bad"}`}>
                    {e.status}
                  </span>{" "}
                  {e.plan_id} · {e.mode} mode · from {e.order_id ?? "no order"}
                </li>
              ))}
            </ul>
          )}
        </section>

        {!FINISHED.has(p.state) && (
          <section className="card">
            <h2>Re-run</h2>
            <p className="note">
              Asks Razorpay about this order again and carries the purchase forward from wherever it
              stopped. It cannot grant anything Razorpay does not confirm, and running it twice
              changes nothing the first run did not.
            </p>
            <form action={rerun}>
              <input type="hidden" name="orderId" value={p.order_id} />
              <button type="submit">Re-check with Razorpay and continue</button>
            </form>
          </section>
        )}

        {captured.length > 0 && (
          <section className="card danger-zone">
            <h2>Restore onto another account</h2>
            <p className="note">
              For the buyer who paid as <strong>{p.checkout_email}</strong> and signed in as somebody
              else. Find their account under <Link href="/admin/users/">Users</Link> and paste its id from
              the address bar. Recorded with your reason.
            </p>
            <form action={restoreTo} className="form">
              <label htmlFor="restore-user">Account id</label>
              <input
                id="restore-user"
                name="userId"
                type="text"
                maxLength={40}
                required
                placeholder="00000000-0000-0000-0000-000000000000"
              />
              <label htmlFor="restore-reason">Reason</label>
              <input id="restore-reason" name="reason" type="text" maxLength={500} required />
              <input type="hidden" name="orderId" value={p.order_id} />
              <button type="submit" className="danger">
                Attach Premium to that account
              </button>
            </form>
          </section>
        )}
      </div>
    </>
  );
}
