import { requireAdmin } from "@/lib/admin";
import { recentAudit } from "@/lib/admin/audit";
import { csvResponse, toCsv } from "@/lib/admin/csv";

export const dynamic = "force-dynamic";

/**
 * The audit log as a CSV.
 *
 * Exporting it is not itself audited, and that is deliberate: a log that records
 * every read of itself fills with entries about being read, and the useful
 * entries get harder to find. Reading changes nothing; the export is a copy of
 * something that already cannot be altered.
 */
export async function GET() {
  await requireAdmin();
  const rows = await recentAudit(500);

  const body = toCsv(
    ["at", "actor", "action", "subject", "reason", "before", "after", "ip"],
    rows.map((r) => [
      r.at,
      r.actor_email,
      r.action,
      r.subject ?? "",
      r.reason ?? "",
      r.before ? JSON.stringify(r.before) : "",
      r.after ? JSON.stringify(r.after) : "",
      r.ip ?? "",
    ]),
  );

  return csvResponse("audit", body);
}
