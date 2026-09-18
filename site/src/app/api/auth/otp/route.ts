import { safeNext } from "@/lib/auth-redirect";
import { clientIp, tooManyAttempts } from "@/lib/auth-throttle";
import { createAnonClient } from "@/lib/supabase/server";

/**
 * Ask for a sign-in email: a one-time link and, where the project has custom
 * SMTP, the code in the same message.
 *
 * It goes through this route rather than straight from the browser, for the same
 * reason as `/api/auth/password/`: a request that leaves the browser cannot be
 * counted. Anyone could otherwise ask for mail to somebody else's address in a
 * loop and burn the project's whole hourly allowance — which would stop every
 * other buyer signing in, and fill a stranger's inbox on the way.
 *
 * Always the same answer, whether or not that address has an account, so the
 * form cannot be used to find out who is a customer. Signups stay closed:
 * `shouldCreateUser: false` (tests/unit/auth-config.test.ts enforces it).
 *
 * The mail is asked for with the anon client, whose flow is implicit, so the
 * link comes back with the tokens in the fragment and works in whichever browser
 * opens it — `/auth/confirm/` stores them. That is the fix for the link that
 * only worked in the browser which asked (walkthrough 38 and 42).
 */

const MAX_BODY = 1_000;
const SAME = { ok: true } as const;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json(SAME);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json(SAME);
  }
  const { email, next } = (body ?? {}) as { email?: unknown; next?: unknown };
  if (typeof email !== "string") return Response.json(SAME);

  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 320) return Response.json(SAME);

  const ip = clientIp(request);
  /* B03: a key of its own. Sharing the password log-in's per-address bucket let anyone
     lock a stranger out of logging in just by asking for their mail. */
  if (tooManyAttempts(ip, `mail:${address}`)) return Response.json({ error: "rate_limited" }, { status: 429 });

  const origin = new URL(request.url).origin;
  const anon = createAnonClient();
  await anon.auth.signInWithOtp({
    email: address,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/callback/?next=${safeNext(typeof next === "string" ? next : null)}`,
    },
  });

  return Response.json(SAME);
}
