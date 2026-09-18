import { requireAdmin } from "@/lib/admin";
import { audit } from "@/lib/admin/audit";
import { getUser } from "@/lib/admin/db";

export const dynamic = "force-dynamic";

/**
 * One account's data, as JSON (docs/ADMIN.md §3.3).
 *
 * For a data request under the privacy policy, when the person cannot get at the
 * export on their own account page — locked out, or asking by email.
 *
 * It contains exactly what `admin_user` returns, which is their account, their
 * purchases, their entitlements and the *shape* of their practice. Not the
 * counts themselves: those belong to them, are theirs to export from their own
 * account, and are not something support should be able to read.
 *
 * The download is audited. Reading somebody's data is an act, even when nothing
 * changes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;

  const user = await getUser(id);
  if (!user) return new Response("Not found", { status: 404 });

  await audit(admin, { action: "user.export", subject: id, after: { email: user.email } });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(user, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="account-${id}-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
