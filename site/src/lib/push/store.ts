import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

import type { ReminderRow } from "./schedule";

/**
 * What the reminder scheduler reads and writes, through the service role — it is
 * a scheduled job with no user session (docs/SECURITY.md §2). Nothing else uses
 * this module.
 */

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "unknown error"}`);
}

export function reminderStore(db: SupabaseClient = createAdminClient()) {
  return {
    async candidates(): Promise<ReminderRow[]> {
      const { data, error } = await db.rpc("reminder_candidates");
      if (error) fail("reading reminder candidates", error);
      return ((data ?? []) as { user_id: string; zone: string; remind_at: number; last_sent_day: string | null }[]).map(
        (r) => ({ userId: r.user_id, zone: r.zone, remindAt: r.remind_at, lastSentDay: r.last_sent_day }),
      );
    },

    /**
     * Whether the user already completed their own target on this local day —
     * one round, per docs/SPEC.md §3. Nobody is reminded about something they
     * have already done.
     */
    async practised(userId: string, day: string): Promise<boolean> {
      const { data, error } = await db
        .from("counter_components")
        .select("rounds")
        .eq("user_id", userId)
        .eq("day", day)
        .gt("rounds", 0)
        .limit(1);
      if (error) fail("reading today's practice", error);
      return (data ?? []).length > 0;
    },

    async tokens(userId: string): Promise<{ sourceId: string; token: string }[]> {
      const { data, error } = await db.from("push_installations").select("source_id, token").eq("user_id", userId);
      if (error) fail("reading devices", error);
      return ((data ?? []) as { source_id: string; token: string }[]).map((r) => ({ sourceId: r.source_id, token: r.token }));
    },

    async dropToken(token: string): Promise<void> {
      const { error } = await db.from("push_installations").delete().eq("token", token);
      if (error) fail("removing stale device", error);
    },

    /**
     * Takes this local day for the user before anything is sent, in one
     * conditional update. False means another run already took it — two
     * overlapping runs must not both notify. The cost of claiming first is that a
     * send that then fails is not retried that day; a duplicate reminder is the
     * worse failure.
     */
    async claimDay(userId: string, day: string): Promise<boolean> {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
      const { data, error } = await db
        .from("reminder_settings")
        .update({ last_sent_day: day })
        .eq("user_id", userId)
        .or(`last_sent_day.is.null,last_sent_day.neq.${day}`)
        .select("user_id");
      if (error) fail("claiming today's reminder", error);
      return (data ?? []).length > 0;
    },
  };
}
