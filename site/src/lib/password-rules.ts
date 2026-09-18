/**
 * The password rule, shared by the reset form in the browser and the reset route
 * on the server so the two can never disagree. The Supabase project enforces the
 * same minimum (10) on its own.
 *
 * Case is not forced: a long phrase with a number in it is both stronger and
 * easier to remember than "Passw0rd!".
 */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export type PasswordProblem = "short" | "long" | "plain" | "has_email";

export function passwordProblem(password: string, email?: string | null): PasswordProblem | null {
  if (password.length < PASSWORD_MIN) return "short";
  if (password.length > PASSWORD_MAX) return "long";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "plain";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && password.toLowerCase().includes(local)) return "has_email";
  return null;
}

export type ResetError = PasswordProblem | "mismatch" | "same" | "link_expired" | "rate_limited" | "leaked" | "failed";

export const PASSWORD_MESSAGES: Record<ResetError, string> = {
  same: "Choose a password different from the one you have now.",
  short: `Use at least ${PASSWORD_MIN} characters.`,
  long: `Use at most ${PASSWORD_MAX} characters.`,
  plain: "Include at least one letter and one number.",
  has_email: "Do not use your email address inside your password.",
  mismatch: "The two passwords do not match.",
  leaked: "That password has appeared in a public breach. Please choose another.",
  link_expired:
    "This reset link has expired or was already used. Ask for a new one — links work once and last 15 minutes.",
  rate_limited: "Too many attempts just now. Please wait a few minutes and try again.",
  failed: "That did not work. Please try again.",
};
