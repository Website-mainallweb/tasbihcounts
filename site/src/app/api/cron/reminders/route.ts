import { flagOn } from "@/lib/flags";
import { cronEnvSecret } from "@/lib/push/cron-secret";
import { isValidCronAuth } from "@/lib/push/cron-auth";
import { sendPush } from "@/lib/push/fcm";
import { isDue } from "@/lib/push/schedule";
import { reminderStore } from "@/lib/push/store";
import { SITE_URL } from "@/lib/site";

/**
 * The reminder run. Called every 15 minutes by Supabase's pg_cron (see
 * docs/DEPLOY.md), with `Authorization: Bearer <CRON_SECRET>`.
 *
 * No user: a scheduled job. The shared secret is its credential, checked in
 * constant time before anything else. Listed in scripts/check-auth-handlers.mjs.
 *
 * For each user whose local reminder time has come: claim the day first, so an
 * overlapping run cannot send the same reminder again; then skip if today's
 * target is already met, otherwise notify every registered device and drop any
 * device FCM says is gone.
 */

export async function POST(request: Request) {
  if (!isValidCronAuth(request.headers.get("authorization"), cronEnvSecret())) {
    return new Response("unauthorized", { status: 401 });
  }

  /* The reminders kill switch (docs/ADMIN.md §3.8).

     It returns 200, not an error: pg_cron will call this again in fifteen
     minutes regardless, and a scheduler that sees failures is a scheduler whose
     failures nobody reads. Nothing is claimed for the day either, so turning
     reminders back on the same evening still sends that evening's — a skipped
     run is skipped, not consumed. */
  if (!(await flagOn("reminders"))) {
    return Response.json({ skipped: "reminders are switched off" });
  }

  const store = reminderStore();
  const now = new Date();
  const summary = { considered: 0, sent: 0, alreadyPractised: 0, staleDevices: 0, failed: 0 };

  for (const row of await store.candidates()) {
    const { due, day } = isDue(row, now);
    if (!due) continue;

    try {
      if (!(await store.claimDay(row.userId, day))) continue;
      summary.considered += 1;

      if (await store.practised(row.userId, day)) {
        summary.alreadyPractised += 1;
        continue;
      }

      for (const device of await store.tokens(row.userId)) {
        const result = await sendPush(device.token, {
          title: "Time for your nam jap",
          body: "A few minutes of chanting keeps your practice — and your streak — alive today.",
          link: `${SITE_URL}/`,
        });
        if (result === "sent") summary.sent += 1;
        else if (result === "stale") {
          summary.staleDevices += 1;
          await store.dropToken(device.token);
        } else summary.failed += 1;
      }
    } catch {
      // One user's failure does not stop everyone else's reminder.
      summary.failed += 1;
    }
  }

  return Response.json(summary);
}
