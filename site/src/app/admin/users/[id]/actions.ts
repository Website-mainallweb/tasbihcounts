"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { audit } from "@/lib/admin/audit";
import {
  confirmUserEmail,
  deleteUserAccount,
  getUser,
  grantEntitlement,
  revokeEntitlement,
  setUserSuspended,
} from "@/lib/admin/db";
import { siteOrigin } from "@/lib/request-origin";
import { createAnonClient } from "@/lib/supabase/server";

/**
 * What an administrator can do to one account (docs/ADMIN.md §3.3).
 *
 * The shape every action here follows:
 *
 *   1. requireAdmin() — in the action itself, never inherited from the page that
 *      rendered the button. A server action is its own entry point and a POST to
 *      it does not have to come from that page.
 *   2. Read the state that is about to change, so the audit row can record what
 *      it actually was rather than what the screen last showed.
 *   3. Do the thing.
 *   4. audit() — which throws if it cannot write, and that throw is not caught.
 *      An action that succeeded with no record is the case the log exists for.
 *
 * The order of 3 and 4 is the one honest compromise. Logging first would record
 * changes that then failed; logging after means a crash between them loses the
 * record of a real change. Since every action here is idempotent and visible in
 * its own right — an entitlement either exists or does not — the log is written
 * after, and a failure to write it is reported as a failure of the action.
 */

const PLAN = "premium_lifetime_v1";

const reasonShape = z
  .string()
  .trim()
  .min(4, "say why")
  .max(500);

const idShape = z.string().uuid();

/** Where an action sends the operator back to, with a message. */
function back(id: string, message: string): never {
  redirect(`/admin/users/${id}/?m=${encodeURIComponent(message)}`);
}

/* -------------------------------------------------------------------------- */

/**
 * Confirm an email by hand.
 *
 * For the buyer whose confirmation mail went to spam, or never arrived because
 * the project's mail allowance ran out. It does not set a password and does not
 * sign anybody in.
 */
export async function confirmEmail(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = idShape.parse(formData.get("id"));

  const before = await getUser(id);
  if (!before) back(id, "That account no longer exists.");
  if (before.confirmed_at) back(id, "That email was already confirmed.");

  try {
    await confirmUserEmail(id);
  } catch (err) {
    back(id, (err as Error).message);
  }

  await audit(admin, {
    action: "user.confirm_email",
    subject: id,
    before: { confirmed_at: null },
    after: { confirmed_at: "set by admin" },
  });

  revalidatePath(`/admin/users/${id}`);
  back(id, "Email confirmed.");
}

/**
 * Send a password reset link.
 *
 * Deliberately the same mail the site's own "forgot password" form sends, to the
 * same page — not a separate admin-only link. One path to a password means one
 * path to audit and one path to get wrong.
 */
export async function sendReset(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = idShape.parse(formData.get("id"));

  const user = await getUser(id);
  if (!user) back(id, "That account no longer exists.");

  /*
   * The link points at whichever host this request arrived on — the live domain
   * in production, localhost while testing — never at a constant and never at
   * anything from the form. See lib/request-origin.ts: a reset sent from a local
   * run used to arrive pointing at the live site, where the one-time token would
   * be spent.
   */
  const { error } = await createAnonClient().auth.resetPasswordForEmail(user.email, {
    redirectTo: `${await siteOrigin()}/auth/reset/`,
  });
  if (error) back(id, `Could not send: ${error.message}`);

  await audit(admin, { action: "user.send_reset", subject: id, after: { email: user.email } });
  back(id, `Reset link sent to ${user.email}.`);
}

/**
 * Suspend and unsuspend.
 *
 * Supabase's ban is on the session, not the data: a suspended account cannot
 * sign in, keeps everything it has, and comes back exactly as it was. That is
 * the right shape for the case this is actually for — an account being argued
 * about — which is why it is separate from deletion.
 */
export async function setSuspended(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = idShape.parse(formData.get("id"));
  const suspend = formData.get("suspend") === "yes";

  const parsed = reasonShape.safeParse(formData.get("reason"));
  if (!parsed.success) back(id, "A reason is required to suspend or restore an account.");

  const before = await getUser(id);
  if (!before) back(id, "That account no longer exists.");

  try {
    await setUserSuspended(id, suspend);
  } catch (err) {
    back(id, (err as Error).message);
  }

  await audit(admin, {
    action: suspend ? "user.suspend" : "user.unsuspend",
    subject: id,
    before: { banned_until: before.banned_until },
    after: { banned_until: suspend ? "100 years" : null },
    reason: parsed.data,
  });

  revalidatePath(`/admin/users/${id}`);
  back(id, suspend ? "Account suspended." : "Account restored.");
}

/**
 * Grant Premium by hand.
 *
 * The support case this exists for: somebody paid with one email and signed in
 * with another. It hands out the paid tier for free, which is exactly why the
 * reason is required and goes into the log alongside what the entitlement was
 * before.
 */
export async function grantPremium(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = idShape.parse(formData.get("id"));

  const parsed = reasonShape.safeParse(formData.get("reason"));
  if (!parsed.success) back(id, "A reason is required to grant Premium.");

  const orderId = String(formData.get("orderId") ?? "").trim();
  if (orderId && !/^order_[A-Za-z0-9]{6,40}$/.test(orderId)) {
    back(id, "That does not look like a Razorpay order id.");
  }

  let previous: string | null;
  try {
    previous = await grantEntitlement(id, PLAN, orderId || undefined);
  } catch (err) {
    back(id, (err as Error).message);
  }

  await audit(admin, {
    action: "entitlement.grant",
    subject: id,
    before: { status: previous },
    after: { status: "active", plan: PLAN, order_id: orderId || null },
    reason: parsed.data,
  });

  revalidatePath(`/admin/users/${id}`);
  back(id, previous === "active" ? "That account already had Premium." : "Premium granted.");
}

/** Take Premium away. The row stays, marked revoked — see the migration. */
export async function revokePremium(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = idShape.parse(formData.get("id"));

  const parsed = reasonShape.safeParse(formData.get("reason"));
  if (!parsed.success) back(id, "A reason is required to revoke Premium.");

  const previous = await revokeEntitlement(id, PLAN);

  await audit(admin, {
    action: "entitlement.revoke",
    subject: id,
    before: { status: previous },
    after: { status: "revoked" },
    reason: parsed.data,
  });

  revalidatePath(`/admin/users/${id}`);
  back(id, previous ? "Premium revoked." : "That account had no entitlement to revoke.");
}

/**
 * Delete the account (docs/ADMIN.md §3.3, ARCHITECTURE M4).
 *
 * Through the same `delete_account` function the person's own account page
 * calls: tombstone first, then the user, so a late webhook or a phone that has
 * been offline for a week cannot resurrect what its owner removed. Purchases
 * keep their row with the account detached and payments stay, as tax law and the
 * privacy policy both require.
 *
 * The typed confirmation is the email, not the word "DELETE". Typing an email
 * you are looking at is a weak check; typing the email of the account you
 * intended to delete is the check that catches the wrong tab.
 */
export async function deleteAccount(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = idShape.parse(formData.get("id"));

  const parsed = reasonShape.safeParse(formData.get("reason"));
  if (!parsed.success) back(id, "A reason is required to delete an account.");

  const user = await getUser(id);
  if (!user) back(id, "That account no longer exists.");

  const typed = String(formData.get("confirmEmail") ?? "").trim().toLowerCase();
  if (typed !== user.email.toLowerCase()) {
    back(id, "The email typed does not match this account. Nothing was deleted.");
  }

  // Logged BEFORE the deletion, uniquely among these actions: afterwards there
  // is no account left to look up, and an audit row naming a uuid nobody can
  // resolve is not much of a record.
  await audit(admin, {
    action: "account.delete",
    subject: id,
    before: { email: user.email, premium: user.premium, purchases: user.purchases.length },
    after: null,
    reason: parsed.data,
  });

  try {
    await deleteUserAccount(id);
  } catch (err) {
    back(id, (err as Error).message);
  }

  redirect(`/admin/users/?m=${encodeURIComponent(`Deleted ${user.email}.`)}`);
}
