import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cache } from "react";

import { createCookieClient, createTokenClient } from "@/lib/supabase/server";

/**
 * The data access layer. Every read or write of user data starts here.
 *
 * Middleware is not a security boundary (docs/SECURITY.md §3): two 2026 CVEs let
 * requests skip it. So every route handler and every server action calls
 * requireUser() or requireBearerUser() itself, even where middleware already
 * checked — scripts/check-auth-handlers.mjs fails the build when one does not.
 *
 * Both verify the token with the auth server through getUser(). getSession()
 * trusts whatever the cookie says, and a forged cookie passes it.
 *
 * What comes back is a client acting as that user, so the queries that follow
 * run under row-level security. There is no service role here.
 */

export type Authed = { user: User; supabase: SupabaseClient };

export class Unauthorized extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "Unauthorized";
  }
}

export class PremiumRequired extends Error {
  readonly status = 403;
  constructor() {
    super("Premium required");
    this.name = "PremiumRequired";
  }
}

async function verify(supabase: SupabaseClient, token?: string): Promise<Authed> {
  const { data, error } = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser();
  if (error || !data?.user) throw new Unauthorized();
  return { user: data.user, supabase };
}

/** The signed-in user from the session cookie. Memoised per request. */
export const requireUser = cache(async (): Promise<Authed> => {
  return verify(await createCookieClient());
});

/** The user named by an `Authorization: Bearer` header — the sync endpoint. */
export async function requireBearerUser(request: Request): Promise<Authed> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/.exec(header);
  if (!match) throw new Unauthorized();
  const token = match[1];
  return verify(createTokenClient(token), token);
}

/**
 * Premium, checked in the database on every call (SECURITY §3: entitlement is
 * never a client fact). The row-level policies enforce the same thing on every
 * write; this lets a route refuse early with a clear status.
 */
export async function requirePremium(authed: Authed): Promise<Authed> {
  const { data, error } = await authed.supabase.rpc("my_premium");
  if (error || data !== true) throw new PremiumRequired();
  return authed;
}

/**
 * The response for a failed check. Says nothing about why: no user id, no
 * token detail, no hint whether the account exists.
 */
export function authErrorResponse(err: unknown): Response {
  if (err instanceof Unauthorized || err instanceof PremiumRequired) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  throw err;
}
