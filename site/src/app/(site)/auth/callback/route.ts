import type { NextRequest } from "next/server";

import { CONFIRM_PATH, LOGIN_PATH, loginErrorFrom, safeNext } from "@/lib/auth-redirect";
import { createCookieClient } from "@/lib/supabase/server";

/**
 * Where Google and the email sign-in link return to.
 *
 * It exchanges Supabase's one-time code for a session cookie and sends the user
 * on. It runs before there is a user, so it cannot call requireUser(); it reads
 * no data either — the page it redirects to verifies the session itself. Listed
 * in scripts/check-auth-handlers.mjs for that reason.
 *
 * Signups are off, so a Google account with no purchase comes back here as an
 * error rather than as a new user, and is told to use the email they paid with.
 *
 * Every redirect is RELATIVE. An absolute one would be built from the host the
 * server believes it is, and behind Hostinger's reverse proxy that is its own
 * internal address: a real user would be sent somewhere unreachable. A relative
 * Location resolves against the address the browser actually used, and safeNext
 * guarantees it stays a path on this site.
 */
function to(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const providerError = params.get("error_description") ?? params.get("error");
  if (providerError) return to(`${LOGIN_PATH}?error=${loginErrorFrom(providerError, params.get("error_code"))}`);

  const code = params.get("code");
  /* No code: an email link. Those use the implicit flow (lib/supabase/browser.ts),
     so the session rides in the address fragment, which never reaches a server.
     A redirect without a fragment of its own keeps the browser's, and
     /auth/confirm/ reads it there. Before this, every such link — including the
     "Premium is ready" email sent after payment — ended in "Sign-in did not work". */
  if (!code) return to(`${CONFIRM_PATH}?next=${safeNext(params.get("next"))}`);

  const supabase = await createCookieClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return to(`${LOGIN_PATH}?error=${loginErrorFrom(error.message, error.code)}`);

  return to(safeNext(params.get("next")));
}
