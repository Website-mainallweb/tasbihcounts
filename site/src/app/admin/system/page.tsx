import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/admin";
import { listReminders, overview, tableCounts } from "@/lib/admin/db";
import { clock, count, day, when } from "@/lib/admin/format";

export const metadata: Metadata = { title: "System" };

const PER_PAGE = 50;

type Props = { searchParams: Promise<{ page?: string }> };

/**
 * What the system is actually doing (docs/ADMIN.md §3.10, §3.13).
 *
 * Reminders and the row counts share a page because they answer the same kind of
 * question — is the machinery running — and neither is big enough to be worth
 * its own tab in a panel with one operator.
 */
export default async function SystemPage({ searchParams }: Props) {
  await requireAdmin();
  const page = Math.max(1, Number((await searchParams).page) || 1);

  const [counts, o, reminders] = await Promise.all([
    tableCounts(),
    overview(),
    listReminders(PER_PAGE, (page - 1) * PER_PAGE),
  ]);
  const pages = Math.max(1, Math.ceil(reminders.total / PER_PAGE));

  const lastSent = reminders.rows
    .map((r) => r.last_sent_day)
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <>
      <div className="wrap">
        <p className="eyebrow">Operations</p>
        <h1>System</h1>

        <h2>Reminders</h2>
        <div className="grid">
          <Stat label="Switched on" value={count(o.reminders_on)} sub={`of ${count(reminders.total)} who set one`} />
          <Stat label="Devices registered" value={count(o.devices)} sub="for push notifications" />
          <Stat
            label="Scheduler last sent"
            value={lastSent ? day(lastSent) : "never"}
            sub="the most recent day anyone was reminded"
          />
        </div>
        <p className="note">
          The scheduler is pg_cron on Supabase, calling the site every fifteen minutes. If
          &ldquo;last sent&rdquo; is old and reminders are on, check that job first — and check the{" "}
          <Link href="/admin/switches/">reminders switch</Link>.
        </p>

        {reminders.rows.length > 0 && (
          <>
            <div className="scroll">
              <table>
                <caption className="sr-only">Reminder settings, most recently changed first.</caption>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">On</th>
                    <th scope="col">Time</th>
                    <th scope="col">Zone</th>
                    <th scope="col">Last sent</th>
                    <th scope="col">Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {reminders.rows.map((r) => (
                    <tr key={r.user_id}>
                      <td>
                        <Link href={`/admin/users/${r.user_id}/`}>{r.user_id.slice(0, 8)}…</Link>
                      </td>
                      <td>
                        {r.enabled ? <span className="pill pill-good">yes</span> : <span className="pill">no</span>}
                      </td>
                      <td>{clock(r.remind_at)}</td>
                      <td>{r.zone}</td>
                      <td>{day(r.last_sent_day)}</td>
                      <td>{when(r.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <nav className="pager" aria-label="Pages">
                {page > 1 && <Link href={`/admin/system/?page=${page - 1}`}>← Previous</Link>}
                <span>
                  Page {page} of {pages}
                </span>
                {page < pages && <Link href={`/admin/system/?page=${page + 1}`}>Next →</Link>}
              </nav>
            )}
          </>
        )}

        <h2>What the database holds</h2>
        <div className="scroll">
          <table>
            <caption className="sr-only">Row counts per table.</caption>
            <thead>
              <tr>
                <th scope="col">Table</th>
                <th scope="col">Rows</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(counts).map(([table, n]) => (
                <tr key={table}>
                  <td>{table}</td>
                  <td>{count(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Backups</h2>
        <p className="note">
          Not shown here, because this panel cannot see them and a green tick it could not verify
          would be worse than nothing. Supabase&rsquo;s own dashboard is the place to check, and
          docs/DEPLOY.md §7 has the restore drill — a backup nobody has restored is a hope, not a
          backup.
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
