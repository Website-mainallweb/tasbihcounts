/**
 * The patterns check-secrets.mjs scans for, kept in their own module so they can
 * be tested. A scanner nobody has watched fire is not a control.
 *
 * Patterns are assembled from fragments so this file does not match itself — a
 * scanner that reports its own source is a scanner people switch off.
 */
const SECRETISH = ["SECRET", "SERVICE" + "_ROLE", "PRIVATE", "TOKEN", "PASSWORD"];

export const RULES = [
  {
    id: "public-secret-name",
    re: new RegExp(`NEXT_PUBLIC_[A-Z0-9_]*(${SECRETISH.join("|")})`),
    why: "A NEXT_PUBLIC_ variable is inlined into the client bundle. Drop the prefix and read it server-side.",
  },
  {
    id: "supabase-access-token",
    re: new RegExp("\\b" + "sbp" + "_[0-9a-f]{40}\\b"),
    why: "Supabase personal access token. Account-wide — revoke it and keep it out of the repo.",
  },
  {
    id: "google-oauth-secret",
    re: new RegExp("\\b" + "GOCSPX" + "-[A-Za-z0-9_-]{20,}"),
    why: "Google OAuth client secret.",
  },
  {
    id: "razorpay-live-key",
    re: new RegExp("\\b" + "rzp" + "_live_[A-Za-z0-9]{10,}"),
    why: "Razorpay live key id.",
  },
  {
    id: "private-key-block",
    re: new RegExp("-----BEGIN [A-Z ]*" + "PRIVATE" + " KEY-----"),
    why: "A private key block — most likely a Firebase service account.",
  },
  {
    id: "jwt-literal",
    // The anon key is legitimately public, but a hard-coded JWT of any role
    // cannot be rotated without a deploy, and the service role key looks
    // identical from the outside.
    re: new RegExp("eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{40,}\\.[A-Za-z0-9_-]{20,}"),
    why: "A JWT literal. Supabase keys belong in env vars, never in a tracked file.",
  },
];

/** A line opts out by saying so, and by saying why. */
export const ALLOW_MARKER = "check-secrets:allow";

/** @returns {{id: string, why: string}[]} every rule this line trips. */
export function scanLine(line) {
  if (line.includes(ALLOW_MARKER)) return [];
  return RULES.filter((r) => r.re.test(line)).map(({ id, why }) => ({ id, why }));
}
