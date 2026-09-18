import type { Metadata } from "next";
import Link from "next/link";

import { ModeBanner } from "@/components/admin/Sidebar";
import { requireAdmin } from "@/lib/admin";
import { overview, reconciliation } from "@/lib/admin/db";
import { count, money, when } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Overview" };

/**
 * The dashboard (docs/ADMIN.md §3.1).
 *
 * The billing alert is first, above the numbers, and it is the only thing on
 * this page that is allowed to shout. Everything else here is curiosity;
 * a captured payment with no Premium behind it is someone who paid and is
 * sitting there without what they bought.
 */
export default async function OverviewPage() {
  await requireAdmin();
  const [o, unreconciled] = await Promise.all([overview(), reconciliation()]);

  return (
    <>
      <div className="wrap">
        <p className="eyebrow">Overview</p>
        <h1>Tasbih Counts</h1>
        <ModeBanner mode={o.mode} />

        {unreconciled.length === 0 ? (
          <p className="ok">
            Billing reconciled — every captured payment has its Premium. Nothing to do.
          </p>
        ) : (
          <section className="alert">
            <h2>
              {unreconciled.length} payment{unreconciled.length === 1 ? "" : "s"} without Premium
            </h2>
            <p>
              Money was captured and the buyer has no active entitlement. Each of these is someone
              who paid and did not get what they paid for.
            </p>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Checkout email</th>
                    <th scope="col">Paid</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Stopped at</th>
                    <th scope="col">Account</th>
                  </tr>
                </thead>
                <tbody>
                  {unreconciled.map((row) => (
                    <tr key={row.payment_id}>
                      <td>
                        <Link href={`/admin/payments/${row.order_id}/`}>{row.order_id}</Link>
                      </td>
                      <td>{row.checkout_email}</td>
                      <td>{when(row.paid_at)}</td>
                      <td>{money(row.amount)}</td>
                      <td>{row.state.replace(/_/g, " ")}</td>
                      <td>{row.user_id ? "exists" : "never created"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="grid">
          <Stat label="Accounts" value={count(o.accounts)} sub={`${count(o.accounts_confirmed)} confirmed`} />
          <Stat label="Premium" value={count(o.premium)} sub={`in ${o.mode} mode`} />
          <Stat
            label="Received"
            value={money(o.revenue_paise)}
            sub={o.refunded_paise > 0 ? `${money(o.refunded_paise)} refunded` : "nothing refunded"}
          />
          <Stat
            label="New accounts"
            value={count(o.signups_today)}
            sub={`${count(o.signups_7d)} this week · ${count(o.signups_30d)} this month`}
          />
          <Stat
            label="Open purchases"
            value={count(o.purchases_open)}
            sub="started and not finished — most are abandoned checkouts"
          />
          <Stat
            label="Reminders on"
            value={count(o.reminders_on)}
            sub={`${count(o.devices)} registered device${o.devices === 1 ? "" : "s"}`}
          />
        </div>

        <p className="note">
          These figures come from the database. Whole-site traffic lives in Google Analytics —{" "}
          <Link href="/admin/analytics/">what this panel can and cannot see</Link>.
        </p>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <section className="card stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      <p className="pending">{sub}</p>
    </section>
  );
}
