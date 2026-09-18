import { z } from "zod";

import { authErrorResponse, requireBearerUser } from "@/lib/dal";

/**
 * Removes this browser from reminders — on sign-out, or when reminders are
 * switched off. A token left behind after sign-out sends someone's reminders to a
 * device they no longer use (SECURITY §8). No Premium check: anyone may remove
 * their own device. Row-level security limits the delete to the caller's rows.
 */

const Body = z.object({ sourceId: z.string().min(1).max(128) });

export async function POST(request: Request) {
  let authed;
  try {
    authed = await requireBearerUser(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const { error } = await authed.supabase
    .from("push_installations")
    .delete()
    .eq("user_id", authed.user.id)
    .eq("source_id", parsed.data.sourceId);
  if (error) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json({ ok: true });
}
