"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { audit } from "@/lib/admin/audit";
import { clearFlagCache } from "@/lib/flags";
import { listFlags, setFlag } from "@/lib/admin/db";

/**
 * Turning a system on or off (docs/ADMIN.md §3.8).
 *
 * No confirmation dialog. These are meant to be reached for during an incident,
 * at speed, possibly from a phone — and every one of them is reversible by
 * pressing the button again. A confirmation step on a reversible emergency
 * control is a step between the operator and the fire.
 *
 * What is not negotiable is the record: who turned what off, and when.
 */
export async function toggleFlag(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const key = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).safeParse(formData.get("key"));
  if (!key.success) redirect("/admin/switches/?m=Unknown+switch.+Nothing+changed.");
  const enabled = formData.get("enabled") === "yes";

  // Read the row rather than trusting the form's idea of the current state: the
  // page may have been open in another tab since before someone else changed it,
  // and the log must say what actually happened.
  const flags = await listFlags();
  const flag = flags.find((f) => f.key === key.data);
  if (!flag) redirect("/admin/switches/?m=Unknown+switch.+Nothing+changed.");

  if (flag.enabled === enabled) {
    redirect(`/admin/switches/?m=${encodeURIComponent(`${key.data} was already ${enabled ? "on" : "off"}.`)}`);
  }

  await setFlag(key.data, enabled);

  await audit(admin, {
    action: enabled ? "flag.enable" : "flag.disable",
    subject: key.data,
    before: { enabled: flag.enabled },
    after: { enabled },
  });

  // The site caches the switches for a minute. Ask it to drop that now, so an
  // emergency control takes effect while the operator is still looking at the
  // screen rather than up to a minute later. Best effort: the cache expires on
  // its own, and the switch is already thrown in the database either way.
  // The switches are cached for a minute on the site's side. Drop that now, so
  // an emergency control takes effect while the operator is still looking at the
  // screen rather than up to a minute later.
  clearFlagCache();
  revalidatePath("/", "layout");

  revalidatePath("/admin/switches");
  redirect(`/admin/switches/?m=${encodeURIComponent(`${key.data} is now ${enabled ? "on" : "off"}.`)}`);
}
