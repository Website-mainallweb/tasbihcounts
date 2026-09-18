import { z } from "zod";

import { authErrorResponse, requireBearerUser, requirePremium } from "@/lib/dal";
import { allow } from "@/lib/rate-limit";

/**
 * Reminder settings for the signed-in user: whether, and at what local time.
 * Read with GET, saved with POST. The zone is checked against Postgres's own list
 * by a trigger, so an unknown one is refused rather than silently never firing.
 */

const Body = z.object({
  enabled: z.boolean(),
  zone: z.string().min(1).max(64),
  remindAt: z.number().int().min(0).max(1439),
});

type Row = { enabled: boolean; zone: string; remind_at: number };

const shape = (r: Row | null) =>
  r ? { enabled: r.enabled, zone: r.zone, remindAt: r.remind_at } : { enabled: false, zone: "Asia/Kolkata", remindAt: 1260 };

export async function GET(request: Request) {
  let authed;
  try {
    authed = await requireBearerUser(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { data, error } = await authed.supabase
    .from("reminder_settings")
    .select("enabled, zone, remind_at")
    .eq("user_id", authed.user.id)
    .maybeSingle<Row>();
  if (error) return Response.json({ error: "unavailable" }, { status: 503 });

  // Whether the asking browser is one of the registered devices, so its switch
  // shows this device's state and not the account's. Never the token itself.
  const sourceId = new URL(request.url).searchParams.get("sourceId");
  let thisDevice = false;
  if (sourceId && sourceId.length <= 128) {
    const device = await authed.supabase
      .from("push_installations")
      .select("source_id")
      .eq("user_id", authed.user.id)
      .eq("source_id", sourceId)
      .maybeSingle();
    if (device.error) return Response.json({ error: "unavailable" }, { status: 503 });
    thisDevice = device.data !== null;
  }
  return Response.json({ ...shape(data), thisDevice });
}

export async function POST(request: Request) {
  let authed;
  try {
    authed = await requirePremium(await requireBearerUser(request));
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!allow(`reminders:${authed.user.id}`, 20, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const { data, error } = await authed.supabase
    .from("reminder_settings")
    .upsert(
      { user_id: authed.user.id, enabled: parsed.data.enabled, zone: parsed.data.zone, remind_at: parsed.data.remindAt },
      { onConflict: "user_id" },
    )
    .select("enabled, zone, remind_at")
    .single<Row>();
  if (error) {
    return Response.json({ error: error.code === "22023" ? "unknown_zone" : "unavailable" }, {
      status: error.code === "22023" ? 400 : 503,
    });
  }
  return Response.json(shape(data));
}
