import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/admin";
import { analytics, overview } from "@/lib/admin/db";
import { count } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Analytics" };

/**
 * What the database can honestly say (docs/ADMIN.md §3.12).
 *
 * The limit stated at the top of this page is not a caveat, it is the headline.
 * Free practice never leaves the browser — that is the product's design, not a
 * gap — so every count here describes signed-in Premium users and nobody else.
 * A dashboard that let someone read "1,188 japs" as the site's total would be
 * worse than no dashboard, because they would plan with it.
 */
export default async function AnalyticsPage() {
  await requireAdmin();
  const [a, o] = await Promise.all([analytics(), overview()]);

  const { accounts, started, paid } = a.funnel;
  const pct = (n: number, of: number) => (of === 0 ? "—" : `${Math.round((n / of) * 100)}%`);

  return (
    <>
      <div className="wrap">
        <p className="eyebrow">Signed-in accounts only</p>
        <h1>Analytics</h1>

        <p className="ok">
          <strong>Free practice never reaches this database.</strong> A visitor who is not signed in
          counts entirely in their own browser, by design — so every number below describes people
          with an account, and mostly people with Premium. Whole-site traffic lives in Google
          Analytics, not here.
        </p>

        <h2>Reaching a purchase</h2>
        <div className="grid">
          <Stat label="Accounts" value={count(accounts)} sub="all time" />
          {/* Deliberately not "% of accounts". Payment comes first here, so most
              of these addresses never became accounts at all — the ratio read
              "1400% of accounts", which is arithmetically true and useless. */}
          <Stat label="Started checkout" value={count(started)} sub="distinct emails that reached an order" />
          <Stat label="Paid" value={count(paid)} sub={`${pct(paid, started)} of those who started`} />
        </div>
        <p className="note">
          &ldquo;Started checkout&rdquo; counts distinct emails that reached an order, including
          people who never finished — and including addresses that never became accounts, since
          payment comes first here.
        </p>

        <h2>Practice that syncs</h2>
        <div className="grid">
          <Stat label="People syncing" value={count(a.synced_users)} sub={`of ${count(o.premium)} Premium`} />
          <Stat label="Counts recorded" value={count(a.synced_japs)} sub={`${count(a.synced_rounds)} rounds`} />
          <Stat
            label="Active"
            value={count(a.active_7d)}
            sub={`this week · ${count(a.active_30d)} this month`}
          />
        </div>

        <h2>Most counted</h2>
        {a.top_names.length === 0 ? (
          <p className="note">Nothing has synced yet.</p>
        ) : (
          <div className="scroll">
            <table>
              <caption className="sr-only">Names by total counts recorded.</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Counts</th>
                  <th scope="col">People</th>
                </tr>
              </thead>
              <tbody>
                {a.top_names.map((n) => (
                  <tr key={n.naam_id}>
                    <td>
                      <Link href={`/admin/names/${n.naam_id}/`}>{n.naam_id}</Link>
                    </td>
                    <td>{count(n.japs)}</td>
                    <td>{count(n.people)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">
          An id that does not open is somebody&rsquo;s own custom dhikr — those are theirs and are
          not in the library.
          {a.unnamed_japs > 0 && (
            <>
              {" "}
              A further <strong>{count(a.unnamed_japs)}</strong> counts are in the totals above but not
              in this list: they were recorded before the counter tracked which name was being
              counted, so they belong to no name.
            </>
          )}
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
