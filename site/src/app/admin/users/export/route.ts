import { requireAdmin } from "@/lib/admin";
import { csvResponse, toCsv } from "@/lib/admin/csv";
import { listUsers, type UserFilter } from "@/lib/admin/db";

export const dynamic = "force-dynamic";

/**
 * The user list as a CSV, honouring whatever search and filter produced the view
 * it was downloaded from (docs/ADMIN.md §3.2).
 *
 * Capped at 5000 rows. An export is for working with a list, not for taking a
 * copy of the database; a bigger one means the wrong tool is being reached for.
 *
 * requireAdmin() runs here as it does on a page — a route handler is an entry
 * point of its own and middleware does not protect it (docs/SECURITY.md §3).
 */
const MAX = 5000;

export async function GET(request: Request) {
  await requireAdmin();

  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").slice(0, 320);
  const filter = (params.get("filter") ?? "all") as UserFilter;

  const rows = await listUsers(q, filter, MAX, 0);

  const body = toCsv(
    ["id", "email", "premium", "joined", "confirmed", "last_sign_in", "suspended_until", "purchases"],
    rows.map((u) => [
      u.id,
      u.email,
      u.premium ? "yes" : "no",
      u.created_at,
      u.confirmed_at ?? "",
      u.last_sign_in ?? "",
      u.banned_until ?? "",
      u.purchases,
    ]),
  );

  return csvResponse("users", body);
}
