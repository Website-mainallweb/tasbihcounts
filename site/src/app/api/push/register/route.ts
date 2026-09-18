import { z } from "zod";

import { authErrorResponse, requireBearerUser, requirePremium } from "@/lib/dal";
import { allow } from "@/lib/rate-limit";

/**
 * Registers this browser for reminders (docs/SECURITY.md §8).
 *
 * The user is the one named by the bearer token; the body carries only this
 * installation's id and its FCM token. claim_push_token() does the write as that
 * user, removes the token from any other account that held it, and refuses a
 * user without Premium.
 */

const Body = z.object({
  sourceId: z.string().min(1).max(128),
  token: z.string().min(20).max(4096),
});

export async function POST(request: Request) {
  let authed;
  try {
    authed = await requirePremium(await requireBearerUser(request));
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!allow(`push-register:${authed.user.id}`, 10, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const { error } = await authed.supabase.rpc("claim_push_token", {
    p_source: parsed.data.sourceId,
    p_token: parsed.data.token,
  });
  if (error) {
    return Response.json({ error: error.code === "42501" ? "forbidden" : "unavailable" }, {
      status: error.code === "42501" ? 403 : 503,
    });
  }
  return Response.json({ ok: true });
}
