import type { Metadata } from "next";

import { requireAdmin } from "@/lib/admin";
import { recentAudit, type AuditRow } from "@/lib/admin/audit";

export const metadata: Metadata = { title: "Audit log" };

/**
 * What has been done in this panel, newest first.
 *
 * Read-only, and not because the UI chose to be: the table refuses UPDATE,
 * DELETE and TRUNCATE at the database
 * (supabase/migrations/20260915120000_admin_audit.sql). There is no screen to
 * add, because the point of a record nobody can tidy is that nobody can tidy it.
 *
 * The last hundred entries, with the last five hundred available as a CSV. No
 * search box: at the volume one operator generates, scrolling finds a thing
 * faster than deciding what to type, and the export covers the rest.
 */
export default async function AuditPage() {
  await requireAdmin();
  const rows = await recentAudit(100);

  return (
    <>
      <div className="wrap">
        <p className="eyebrow">Append-only</p>
        <h1>Audit log</h1>
        <p className="lede">
          Every change made through this panel, with what it looked like before and after. Nothing
          here can be edited or removed — not from this screen, and not by the panel at all.
        </p>

        <p className="row-actions">
          <a className="pill" href="/admin/audit/export/">
            Export CSV
          </a>
        </p>

        {rows.length === 0 ? (
          <p className="note">Nothing recorded yet.</p>
        ) : (
          <div className="scroll">
            <table>
              <caption className="sr-only">
                Administrator actions, most recent first. {rows.length} shown.
              </caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* The operator works in India and every other timestamp in this project is
   written in IST; a log that disagreed with the payment screens about what
   "yesterday" means would be worse than useless. */
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

function Row({ row }: { row: AuditRow }) {
  return (
    <tr>
      <td>{when(row.at)}</td>
      <td>{row.actor_email}</td>
      <td>{row.action}</td>
      <td>{row.subject ?? "—"}</td>
      <td className="wrapcell">
        {/* JSON.stringify, not a rendered object: these values were written by
            an earlier version of this code and may hold anything. React escapes
            the text either way, and showing it raw is what a log is for. */}
        {row.before && <div className="note">before: {JSON.stringify(row.before)}</div>}
        {row.after && <div className="note">after: {JSON.stringify(row.after)}</div>}
        {row.reason && <div className="note">reason: {row.reason}</div>}
        {!row.before && !row.after && !row.reason && "—"}
      </td>
    </tr>
  );
}
