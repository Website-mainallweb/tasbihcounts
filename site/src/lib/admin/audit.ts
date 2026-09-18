import "server-only";

import { headers } from "next/headers";

import type { Admin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Writing to the audit log (docs/ADMIN.md §2).
 *
 * The rule that makes this worth having: **log before you report success, and
 * fail the action if the log fails.** An action that succeeded without a record
 * is exactly the case the log exists for, so a log that quietly drops writes is
 * worse than no log — it looks like evidence and is not.
 *
 * The table is append-only in the database, not merely by convention here: a
 * trigger refuses every UPDATE, DELETE and TRUNCATE
 * (supabase/migrations/20260915120000_admin_audit.sql).
 */

export type AuditEntry = {
  /** A stable machine name: 'entitlement.grant', 'account.delete'. */
  action: string;
  /** The user id, order id or setting key acted on. */
  subject?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Required by the actions whose UI asks for one. */
  reason?: string;
};

/**
 * Where the request came from, as the proxies in front of us describe it.
 *
 * The WHOLE `x-forwarded-for` chain, not one hop of it, and that is deliberate.
 * Its leftmost entry is the address the client claimed — usually true, and
 * forgeable by anyone who sets the header. Every entry after it was appended by
 * a proxy, ending with the one nearest us. Picking either end alone would be a
 * half-truth: the left one can be invented, the right one is Hostinger's own
 * machine and says nothing about who was at the keyboard.
 *
 * This is a log, not a check. Nothing is allowed or refused on the strength of
 * it, so recording all of it and letting a human read it later is both the most
 * useful and the most honest thing to store.
 */
function requestOrigin(h: Headers): string | null {
  const chain = h.get("x-forwarded-for")?.trim();
  if (chain) return chain.slice(0, 64);
  return h.get("x-real-ip")?.trim().slice(0, 64) ?? null;
}

export class AuditFailed extends Error {
  constructor(cause: string) {
    super(`The action was not performed: its audit record could not be written (${cause})`);
    this.name = "AuditFailed";
  }
}

/**
 * Record one action. Throws if the record cannot be written, and the caller must
 * let that throw — do not catch it and carry on.
 */
export async function audit(admin: Admin, entry: AuditEntry): Promise<void> {
  const { error } = await createAdminClient()
    .from("admin_audit")
    .insert({
      actor_id: admin.user.id,
      actor_email: admin.email,
      action: entry.action,
      subject: entry.subject ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? null,
      ip: requestOrigin(await headers()),
    });

  if (error) throw new AuditFailed(error.message);
}

/**
 * The shape the log reads back in. `before` and `after` are whatever the action
 * put there, so anything rendering them must treat the values as untrusted text.
 */
export type AuditRow = {
  id: number;
  actor_email: string;
  action: string;
  subject: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
  at: string;
};

/** The most recent entries, newest first. The panel's own history screen. */
export async function recentAudit(limit = 100): Promise<AuditRow[]> {
  const { data, error } = await createAdminClient()
    .from("admin_audit")
    .select("id, actor_email, action, subject, before, after, reason, ip, at")
    .order("at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));

  if (error) throw new Error(`Could not read the audit log: ${error.message}`);
  return (data ?? []) as AuditRow[];
}
