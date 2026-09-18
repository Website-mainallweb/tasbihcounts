/**
 * Where sign-in sends people, and what it tells them when it fails.
 *
 * Pure functions, shared by the login form in the browser and the callback route
 * on the server, so the two can never disagree about what an error means.
 */

export const LOGIN_PATH = "/login/";
export const ACCOUNT_PATH = "/account/";
/** Where an email link's session, carried in the fragment, is stored. */
export const CONFIRM_PATH = "/auth/confirm/";

export type LoginError = "no_account" | "link_expired" | "rate_limited" | "bad_credentials" | "failed";

/**
 * Only a path on this site. Anything else — an absolute URL, a protocol-relative
 * `//host`, a backslash, an encoded slash — falls back to the account page, so the
 * callback cannot be used to bounce a freshly signed-in user to someone else's site.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(raw)) return ACCOUNT_PATH;
  return raw;
}

/**
 * Supabase's wording, reduced to the four things a buyer needs to know. Signups
 * are off, so "not allowed" means there is no purchase for that email.
 */
export function loginErrorFrom(message?: string | null, code?: string | null): LoginError {
  const text = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  if (/signup_disabled|signups? not allowed|user not found|otp_disabled/.test(text)) return "no_account";
  if (/rate limit|too many|over_email_send_rate_limit/.test(text)) return "rate_limited";
  if (/expired|already (been )?used|invalid (flow state|grant|code)|otp_expired|bad_code_verifier/.test(text)) {
    return "link_expired";
  }
  return "failed";
}

export function isLoginError(value: string | null | undefined): value is LoginError {
  return (
    value === "no_account" ||
    value === "link_expired" ||
    value === "rate_limited" ||
    value === "bad_credentials" ||
    value === "failed"
  );
}

export const LOGIN_MESSAGES: Record<LoginError, string> = {
  no_account:
    "There is no Premium purchase for that account. Log in with the same email address you used to pay.",
  link_expired: "That log-in link has expired or was already used. Choose Log in with an email code below for a fresh one.",
  rate_limited: "Too many attempts just now. Please wait a few minutes and try again.",
  /* One sentence for every wrong email, wrong password and account without a
     password: the form must not tell a stranger which addresses exist. */
  bad_credentials: "That email address and password do not match an account. Check both, or log in with an email code instead.",
  failed: "Logging in did not work. Please try again, or write to us if it keeps happening.",
};
