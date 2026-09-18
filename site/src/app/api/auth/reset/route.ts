import { cookies } from "next/headers";

import { clientIp, noteFailure, tooManyAttempts } from "@/lib/auth-throttle";
import { passwordProblem } from "@/lib/password-rules";
import { allow } from "@/lib/rate-limit";
import { GRANT_COOKIE, GRANT_MS, holdsGrant, issueGrant, spendGrant } from "@/lib/reset-grant";
import { createCookieClient } from "@/lib/supabase/server";

/**
 * Finishes "Forgot password?": sets the new password from the link in the email.
 *
 * The email links to /auth/reset/?token_hash=…, a page that does NOTHING on load.
 * The token is spent only here, when the person presses "Set new password" — a
 * mail scanner that opens the link first (Gmail's did, 2026-09-12) no longer
 * burns it.
 *
 * It runs before there is a user, so it cannot call requireUser(); the recovery
 * token IS the proof, verified with Supabase. Listed in
 * scripts/check-auth-handlers.mjs for that reason.
 *
 * Two ways in:
 *  - with the token: verify it (which signs the browser in) and set the password;
 *  - without it, straight after a first try that verified the token but was
 *    refused (a password containing the address): only with the one-time reset
 *    grant that first try left (lib/reset-grant.ts). An ordinary signed-in
 *    browser has no grant, so it cannot use this route to skip the current
 *    password.
 */

const MAX_BODY = 2_000;
const PER_NETWORK = 20;
const WINDOW_MS = 10 * 60_000;

const fail = (error: string, status = 400) => Response.json({ error }, { status });
/* B73: a refusal after the token was spent says so, so the form retries on the
   grant instead of resending a token that no longer works. */
const failVerified = (error: string, status = 400) => Response.json({ error, verified: true }, { status });

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail("failed");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("failed");
  }
  const { token_hash: tokenHash, password } = (body ?? {}) as { token_hash?: unknown; password?: unknown };
  if (typeof password !== "string") return fail("short");
  if (tokenHash !== undefined && (typeof tokenHash !== "string" || !/^[A-Za-z0-9_-]{8,256}$/.test(tokenHash))) {
    return fail("link_expired");
  }

  const ip = clientIp(request);
  if (!allow(`reset:i:${ip}`, PER_NETWORK, WINDOW_MS)) return fail("rate_limited", 429);

  // Checked before the token is spent, so a too-short password costs nothing.
  const early = passwordProblem(password);
  if (early) return fail(early);

  const store = await cookies();
  const supabase = await createCookieClient();
  let email: string | null;
  let grant = store.get(GRANT_COOKIE)?.value;

  if (typeof tokenHash === "string") {
    const { data, error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error || !data.user) {
      noteFailure(ip, `reset:${ip}`);
      return fail("link_expired");
    }
    email = data.user.email ?? null;
    grant = issueGrant(data.user.id);
    store.set(GRANT_COOKIE, grant, {
      httpOnly: true,
      sameSite: "strict",
      // Behind Hostinger's proxy the request itself arrives as plain http.
      secure:
        new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
      path: "/api/auth/reset/",
      maxAge: GRANT_MS / 1000,
    });
  } else {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user || !holdsGrant(grant, data.user.id)) return fail("link_expired");
    email = data.user.email ?? null;
  }

  if (email && tooManyAttempts(ip, `reset:${email}`)) return failVerified("rate_limited", 429);

  const problem = passwordProblem(password, email);
  if (problem) return failVerified(problem);

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const text = `${error.code ?? ""} ${error.message}`.toLowerCase();
    if (/weak|pwned|leaked/.test(text)) return failVerified("leaked");
    if (/same|different from the old/.test(text)) return failVerified("same");
    if (/at least|short/.test(text)) return failVerified("short");
    if (/character|letter|digit|symbol/.test(text)) return failVerified("plain");
    return failVerified("failed");
  }

  spendGrant(grant);
  store.delete({ name: GRANT_COOKIE, path: "/api/auth/reset/" });
  return Response.json({ ok: true });
}
