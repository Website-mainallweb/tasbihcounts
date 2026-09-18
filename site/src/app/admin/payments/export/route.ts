import { requireAdmin } from "@/lib/admin";
import { csvResponse, toCsv } from "@/lib/admin/csv";
import { listPurchases } from "@/lib/admin/db";

export const dynamic = "force-dynamic";

/** The purchase list as a CSV, matching the view it was downloaded from. */
const MAX = 5000;

export async function GET(request: Request) {
  await requireAdmin();

  const params = new URL(request.url).searchParams;
  const { rows } = await listPurchases({
    q: params.get("q") ?? "",
    state: params.get("state") ?? "all",
    limit: MAX,
    offset: 0,
  });

  const body = toCsv(
    ["order_id", "checkout_email", "state", "amount_paise", "currency", "mode", "user_id", "created", "updated"],
    rows.map((p) => [
      p.order_id,
      p.checkout_email,
      p.state,
      p.expected_amount,
      p.expected_currency,
      p.mode,
      p.user_id ?? "",
      p.created_at,
      p.updated_at,
    ]),
  );

  return csvResponse("purchases", body);
}
