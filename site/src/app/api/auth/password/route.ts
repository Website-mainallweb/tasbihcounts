import { clientIp, noteFailure, noteSuccess, tooManyAttempts } from "@/lib/auth-throttle";
import { createCookieClient } from "@/lib/supabase/server";

/**
 * Sign in with an email address and a password.
 *
 * It goes through this route, not straight to Supabase from the browser, so the
 * attempts can be counted per address and per network (lib/auth-throttle.ts) and
 * so the session lands in the same cookies every other page reads.
 *
 * One answer for every refusal. "No such account", "wrong password" and "this
 * account has no password yet" are the same sentence, so nobody can use the
 * form to find out which addresses exist. Nothing is logged.
 *
 * Signups stay closed (docs/SECURITY.md §3): this signs people in, it never
 * creates anyone. Accounts are made by a completed payment.
 */

const MAX_BODY = 2_000;
const REFUSED = { error: "bad_credentials" as const };

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json(REFUSED, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json(REFUSED, { status: 401 });
  }
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string") return Response.json(REFUSED, { status: 401 });

  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 320) {
    return Response.json(REFUSED, { status: 401 });
  }
  if (password.length < 1 || password.length > 200) return Response.json(REFUSED, { status: 401 });

  const ip = clientIp(request);
  if (tooManyAttempts(ip, address)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const supabase = await createCookieClient();
  const { error } = await supabase.auth.signInWithPassword({ email: address, password });
  if (error) {
    noteFailure(ip, address);
    return Response.json(REFUSED, { status: 401 });
  }

  noteSuccess(ip, address);
  return Response.json({ ok: true });
}
