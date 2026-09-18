"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { audit } from "@/lib/admin/audit";
import { setPaymentMode } from "@/lib/admin/db";

/**
 * Switching between test and live (docs/ADMIN.md §3.7).
 *
 * The confirmation is typing the target mode, not pressing a second button. The
 * mistake this is guarding against is not a mis-click, it is doing it on the
 * wrong day — and a word you have to read and copy is the only confirmation that
 * makes you look at which way round it is.
 */
export async function switchMode(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const target = z.enum(["test", "live"]).safeParse(formData.get("target"));
  if (!target.success) redirect("/admin/payments/mode/?m=Unknown+mode.+Nothing+changed.");

  const reason = z.string().trim().min(4).max(500).safeParse(formData.get("reason"));
  if (!reason.success) {
    redirect("/admin/payments/mode/?m=A+reason+is+required+to+change+payment+mode.");
  }

  const typed = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (typed !== target.data) {
    redirect("/admin/payments/mode/?m=The+word+typed+did+not+match.+Nothing+changed.");
  }

  // The function returns the mode it replaced, so the log records what actually
  // changed rather than what the page was showing when it was loaded.
  const previous = await setPaymentMode(target.data);

  await audit(admin, {
    action: "payment_mode.set",
    subject: "app_config",
    before: { payment_mode: previous },
    after: { payment_mode: target.data },
    reason: reason.data,
  });

  revalidatePath("/admin/payments/mode");
  revalidatePath("/");

  if (previous === target.data) {
    redirect(`/admin/payments/mode/?m=${encodeURIComponent(`Already ${target.data}. Nothing changed.`)}`);
  }
  redirect(
    `/admin/payments/mode/?m=${encodeURIComponent(`Now ${target.data}. Entitlements in ${previous} mode have stopped counting.`)}`,
  );
}
