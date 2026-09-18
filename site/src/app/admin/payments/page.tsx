import type { Metadata } from "next";
import Link from "next/link";

import { ModeBanner } from "@/components/admin/Sidebar";
import { requireAdmin } from "@/lib/admin";
import { listPurchases, paymentMode } from "@/lib/admin/db";
import { count, money, when } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Payments" };

const PER_PAGE = 50;

/** Every state a purchase row can be in, from the Phase 7 enum. */
const STATES = [
  "all",
  "created",
  "payment_verified",
  "captured",
  "user_created",
  "entitlement_active",
  "notified",
  "failed_recoverable",
  "refunded",
  "revoked",
] as const;

type Props = { searchParams: Promise<{ q?: string; state?: string; page?: string }> };

/**
 * Every order, not only the one that was searched for (docs/ADMIN.md §3.4).
 *
 * The site's old support page could answer "what happened to this order" if you
 * already knew the order. This one answers "what is going wrong today", which is
 * the question you have before you know which order to ask about.
 */
export default async function PaymentsPage({ searchParams }: Props) {
  await requireAdmin();
  const params = await searchParams;

  const q = (params.q ?? "").slice(0, 320);
  const state = STATES.includes(params.state as (typeof STATES)[number]) ? params.state! : "all";
  const page = Math.max(1, Number(params.page) || 1);

  const [{ rows, total }, mode] = await Promise.all([
    listPurchases({ q, state, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
    paymentMode(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const link = (to: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (state !== "all") next.set("state", state);
    if (to > 1) next.set("page", String(to));
    const query = next.toString();
    return query ? `/admin/payments/?${query}` : "/admin/payments/";
  };

  return (
    <>
      <div className="wrap">
        <p className="eyebrow">{count(total)} matching</p>
        <h1>Payments</h1>
        <ModeBanner mode={mode} />

        <form className="toolbar" method="get">
          <div>
            <label htmlFor="q">Order id or checkout email</label>
            <input id="q" name="q" type="text" defaultValue={q} maxLength={320} placeholder="order_… or name@example.com" />
          </div>
          <div>
            <label htmlFor="state">State</label>
            <select id="state" name="state" defaultValue={state}>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "Any" : s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <button type="submit">Search</button>
          <a className="pill" href={`/admin/payments/export/?${new URLSearchParams({ q, state })}`}>
            Export CSV
          </a>
          <Link className="pill" href="/admin/payments/mode/">
            Payment mode: {mode}
          </Link>
        </form>

        {rows.length === 0 ? (
          <p className="note">No purchase matches that.</p>
        ) : (
          <div className="scroll">
            <table>
              <caption className="sr-only">
                Purchases, newest first. Page {page} of {pages}.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Checkout email</th>
                  <th scope="col">State</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Started</th>
                  <th scope="col">Account</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.order_id}>
                    <td>
                      <Link href={`/admin/payments/${p.order_id}/`}>{p.order_id}</Link>
                    </td>
                    <td>{p.checkout_email}</td>
                    <td>
                      <span className={`pill ${stateTone(p.state)}`}>{p.state.replace(/_/g, " ")}</span>
                    </td>
                    <td>{money(p.expected_amount, p.expected_currency)}</td>
                    <td>{p.mode}</td>
                    <td>{when(p.created_at)}</td>
                    <td>
                      {p.user_id ? (
                        <Link href={`/admin/users/${p.user_id}/`}>account</Link>
                      ) : (
                        <span className="pending">none</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <nav className="pager" aria-label="Pages">
            {page > 1 && <Link href={link(page - 1)}>← Previous</Link>}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages && <Link href={link(page + 1)}>Next →</Link>}
          </nav>
        )}
      </div>
    </>
  );
}

/**
 * 'notified' is the end of a successful purchase; 'failed_recoverable' is the one
 * that wants a person. Everything in between is simply in progress, and colouring
 * it would teach the eye to ignore the colour.
 */
function stateTone(state: string): string {
  if (state === "notified" || state === "entitlement_active") return "pill-good";
  if (state === "failed_recoverable" || state === "revoked") return "pill-bad";
  return "";
}
