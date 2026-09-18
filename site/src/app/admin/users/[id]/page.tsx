import type { Metadata } from "next";
import Link from "next/link";

import {
  confirmEmail,
  deleteAccount,
  grantPremium,
  revokePremium,
  sendReset,
  setSuspended,
} from "./actions";
import { requireAdmin } from "@/lib/admin";
import { getUser } from "@/lib/admin/db";
import { clock, count, day, money, when } from "@/lib/admin/format";

export const metadata: Metadata = { title: "User" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string }>;
};

/**
 * One account (docs/ADMIN.md §3.2, §3.3).
 *
 * What this page shows about their practice is its shape and nothing else — how
 * many names, how many days, when it last synced. Support does not need to read
 * somebody's chanting to answer a question about their payment, and `admin_user`
 * has no route that would return it.
 */
export default async function UserPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  const { m } = await searchParams;

  const user = await getUser(id);

  if (!user) {
    return (
      <>
        <div className="wrap">
          <Link className="back" href="/admin/users/">
            ← Users
          </Link>
          <h1>No such account</h1>
          <p className="note">
            It was deleted, or the address is wrong. A deleted account leaves its purchases behind —
            search <Link href="/admin/payments/">Payments</Link> by the checkout email.
          </p>
        </div>
      </>
    );
  }

  const suspended = Boolean(user.banned_until && new Date(user.banned_until) > new Date());

  return (
    <>
      <div className="wrap">
        <Link className="back" href="/admin/users/">
          ← Users
        </Link>
        <p className="eyebrow">{user.premium ? "Premium" : "Free"}</p>
        <h1>{user.email}</h1>

        <div aria-live="polite">{m && <p className="banner">{m}</p>}</div>

        <section className="card">
          <h2>Account</h2>
          <dl className="facts">
            <div>
              <dt>Joined</dt>
              <dd>{when(user.created_at)}</dd>
            </div>
            <div>
              <dt>Email confirmed</dt>
              <dd>{user.confirmed_at ? when(user.confirmed_at) : "never"}</dd>
            </div>
            <div>
              <dt>Last sign-in</dt>
              <dd>{when(user.last_sign_in)}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{suspended ? `suspended until ${day(user.banned_until)}` : "active"}</dd>
            </div>
            <div>
              <dt>Devices for reminders</dt>
              <dd>{count(user.devices)}</dd>
            </div>
            <div>
              <dt>Reminder</dt>
              <dd>
                {user.reminder?.enabled
                  ? `${clock(user.reminder.at)} ${user.reminder.zone}`
                  : "off"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2>Synced practice</h2>
          <p className="pending">
            The shape of it only. This panel has no way to read anybody&rsquo;s counts.
          </p>
          <dl className="facts">
            <div>
              <dt>Names</dt>
              <dd>{count(user.sync.names)}</dd>
            </div>
            <div>
              <dt>Days</dt>
              <dd>{count(user.sync.days)}</dd>
            </div>
            <div>
              <dt>Rows</dt>
              <dd>{count(user.sync.rows)}</dd>
            </div>
            <div>
              <dt>Last sync</dt>
              <dd>{when(user.sync.last)}</dd>
            </div>
            <div>
              <dt>Settings saved</dt>
              <dd>{when(user.sync.settings_updated)}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2>Purchases</h2>
          {user.purchases.length === 0 ? (
            <p className="note">None on this account.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">State</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Checkout email</th>
                    <th scope="col">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {user.purchases.map((p) => (
                    <tr key={p.order_id}>
                      <td>
                        <Link href={`/admin/payments/${p.order_id}/`}>{p.order_id}</Link>
                      </td>
                      <td>{p.state.replace(/_/g, " ")}</td>
                      <td>{money(p.amount, p.currency)}</td>
                      <td>{p.mode}</td>
                      <td>{p.email}</td>
                      <td>{when(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Entitlements</h2>
          {user.entitlements.length === 0 ? (
            <p className="note">None. This account has never had Premium.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Plan</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Status</th>
                    <th scope="col">Order</th>
                    <th scope="col">Granted</th>
                  </tr>
                </thead>
                <tbody>
                  {user.entitlements.map((e) => (
                    <tr key={`${e.plan_id}-${e.mode}`}>
                      <td>{e.plan_id}</td>
                      <td>{e.mode}</td>
                      <td>
                        <span className={`pill ${e.status === "active" ? "pill-good" : "pill-bad"}`}>
                          {e.status}
                        </span>
                      </td>
                      <td>{e.order_id ?? "—"}</td>
                      <td>{when(e.granted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Actions</h2>
          <div className="row-actions">
            {!user.confirmed_at && (
              <form action={confirmEmail}>
                <input type="hidden" name="id" value={user.id} />
                <button type="submit" className="quiet">
                  Confirm email by hand
                </button>
              </form>
            )}
            <form action={sendReset}>
              <input type="hidden" name="id" value={user.id} />
              <button type="submit" className="quiet">
                Send password reset link
              </button>
            </form>
            {/* A plain anchor, not <Link>. Next prefetches a Link, and
                prefetching a route handler runs it: the audit log filled with a
                user.export that nobody had asked for, from opening this page.
                A download is not a page and should not be prefetched. */}
            <a className="pill" href={`/admin/users/${user.id}/export/`}>
              Export their data
            </a>
          </div>
        </section>

        {/* Everything below changes what someone paid for, or ends their account.
            Each one asks for a reason, and the reason goes into the audit log. */}
        <section className="card danger-zone">
          <h2>Premium by hand</h2>
          <p className="note">
            For the buyer who paid with one email and signed in with another. Both of these are
            recorded with your reason.
          </p>

          <form action={grantPremium} className="form">
            <label htmlFor="grant-order">Razorpay order id (optional)</label>
            <input id="grant-order" name="orderId" type="text" maxLength={64} placeholder="order_…" />
            <label htmlFor="grant-reason">Reason</label>
            <input id="grant-reason" name="reason" type="text" maxLength={500} required />
            <input type="hidden" name="id" value={user.id} />
            <button type="submit">Grant Premium</button>
          </form>

          {user.premium && (
            <form action={revokePremium} className="form">
              <label htmlFor="revoke-reason">Reason for revoking</label>
              <input id="revoke-reason" name="reason" type="text" maxLength={500} required />
              <input type="hidden" name="id" value={user.id} />
              <button type="submit" className="danger">
                Revoke Premium
              </button>
            </form>
          )}
        </section>

        <section className="card danger-zone">
          <h2>{suspended ? "Restore" : "Suspend"}</h2>
          <p className="note">
            Suspending blocks sign-in and changes nothing else. Everything they have is kept and
            comes back exactly as it was.
          </p>
          <form action={setSuspended} className="form">
            <label htmlFor="suspend-reason">Reason</label>
            <input id="suspend-reason" name="reason" type="text" maxLength={500} required />
            <input type="hidden" name="id" value={user.id} />
            <input type="hidden" name="suspend" value={suspended ? "no" : "yes"} />
            <button type="submit" className={suspended ? "quiet" : "danger"}>
              {suspended ? "Restore this account" : "Suspend this account"}
            </button>
          </form>
        </section>

        <section className="card danger-zone">
          <h2>Delete</h2>
          <p className="note">
            Permanent. Their counts, settings, devices and entitlement go; the purchase and payment
            rows stay, with the account detached, because tax law requires it. Type the account
            email to confirm — that is what catches the wrong tab.
          </p>
          <form action={deleteAccount} className="form">
            <label htmlFor="delete-email">Type {user.email}</label>
            <input id="delete-email" name="confirmEmail" type="email" maxLength={320} required autoComplete="off" />
            <label htmlFor="delete-reason">Reason</label>
            <input id="delete-reason" name="reason" type="text" maxLength={500} required />
            <input type="hidden" name="id" value={user.id} />
            <button type="submit" className="danger">
              Delete this account
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
