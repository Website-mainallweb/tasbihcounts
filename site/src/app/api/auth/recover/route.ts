import { clientIp, tooManyAttempts } from "@/lib/auth-throttle";
import { signInLinkOrigin } from "@/lib/payments/origin";
import { allow } from "@/lib/rate-limit";
import { createAnonClient } from "@/lib/supabase/server";

/**
 * "I forgot my password" (and "set my first password"): sends the reset email.
 *
 * The email links to /auth/reset/?token_hash=…&type=recovery. That page spends
 * nothing on load; the token is used only when the person presses Set new
 * password (see /api/auth/reset/). The project's "Reset password" email template
 * must build that link:
 *
 *   {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery
 *
 * Always answers the same way, whether or not that address has an account —
 * otherwise this form becomes a way to check which addresses are customers.
 * Limited three ways: the sign-in budget per address and network, and on top of
 * it at most three reset mails an hour per address, so nobody can fill a
 * stranger's inbox or spend the project's mail allowance.
 */

const MAX_BODY = 1_000;
const SAME = { ok: true } as const;
const MAILS_PER_HOUR = 3;
const HOUR = 60 * 60_000;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json(SAME);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json(SAME);
  }
  const { email } = (body ?? {}) as { email?: unknown };
  if (typeof email !== "string") return Response.json(SAME);
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 320) return Response.json(SAME);

  const ip = clientIp(request);
  /* B03: a key of its own. Sharing the password log-in's per-address bucket let anyone
     lock a stranger out of logging in just by asking for their mail. */
  if (tooManyAttempts(ip, `mail:${address}`)) return Response.json({ error: "rate_limited" }, { status: 429 });
  if (!allow(`recover:e:${address}`, MAILS_PER_HOUR, HOUR)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const anon = createAnonClient();
  await anon.auth.resetPasswordForEmail(address, {
    redirectTo: `${signInLinkOrigin(request)}/auth/reset/`,
  });

  return Response.json(SAME);
}
