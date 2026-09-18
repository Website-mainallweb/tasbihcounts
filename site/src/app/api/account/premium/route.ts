import { authErrorResponse, requireUser } from "@/lib/dal";

/**
 * Whether the signed-in account holds Premium — asked once per visit by the
 * header (B01).
 *
 * Only /account/ used to record the answer in the browser, and since sign-in
 * happens in a popup that leaves people on the page they were on, a buyer could
 * go on seeing the promo bar, the Premium cards and ads, and even the Pay form,
 * until they happened to open their account page. The answer here only decides
 * what the browser shows; everything that costs money still checks the database
 * itself.
 */
export async function GET() {
  let authed;
  try {
    authed = await requireUser();
  } catch (err) {
    return authErrorResponse(err);
  }
  const { data, error } = await authed.supabase.rpc("my_premium");
  if (error) return Response.json({ error: "failed" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  return Response.json({ premium: data === true }, { headers: { "Cache-Control": "private, no-store" } });
}
