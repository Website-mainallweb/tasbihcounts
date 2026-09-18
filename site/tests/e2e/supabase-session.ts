import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A real signed-in session against the live Supabase project, for tests that need
 * one. The user is temporary and removed through the real deletion path.
 *
 * Reads site/.env.local. When it is absent — CI has no secrets — `liveSupabase()`
 * returns null and the tests that need it skip themselves.
 *
 * Not named `*.spec.ts`, so Playwright does not collect it as a suite.
 */

type Env = Record<string, string>;

function readEnv(): Env | null {
  // __dirname, not import.meta: Playwright loads these files as CommonJS, and
  // import.meta there is a syntax error that stops the whole suite loading.
  const file = join(__dirname, "../../.env.local");
  if (!existsSync(file)) return null;
  const env: Env = Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
      }),
  );
  const needed = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  return needed.every((k) => env[k]) ? env : null;
}

export type TempUser = {
  id: string;
  email: string;
  /** The password it was created with, for the sign-in form tests. */
  password: string;
  /** Cookies that carry the session, ready for context.addCookies(). */
  cookies: { name: string; value: string; domain: string; path: string; sameSite: "Lax" }[];
  remove: () => Promise<void>;
};

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function liveSupabase() {
  const env = readEnv();
  if (!env) return null;
  const admin: SupabaseClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, opts);

  /**
   * Delete a purchase this suite created.
   *
   * Only ever called with an order id the test just made. Purchases have no
   * delete guard — unlike names and the audit log, they are not history anybody
   * relies on until a payment attaches to one, and this one never got that far.
   */
  async function removePurchase(orderId: string): Promise<void> {
    await admin.from("purchases").delete().eq("order_id", orderId);
  }

  async function createUser({ premium, host }: { premium: boolean; host: string }): Promise<TempUser> {
    const email = `e2e-${randomBytes(4).toString("hex")}@example.com`;
    const password = `${randomBytes(24).toString("base64url")}a1`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`creating e2e user: ${created.error.message}`);
    const id = created.data.user.id;

    const remove = async () => {
      await admin.rpc("delete_account", { target: id });
      if (env!.SUPABASE_ACCESS_TOKEN) {
        const ref = new URL(env!.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
        await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env!.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `delete from private.account_tombstones where user_id = '${id.replace(/[^0-9a-f-]/g, "")}';`,
          }),
        });
      }
    };

    try {
      if (premium) {
        const grant = await admin
          .from("entitlements")
          .insert({ user_id: id, plan_id: "premium_lifetime_v1", mode: "test", status: "active" });
        if (grant.error) throw new Error(`granting e2e entitlement: ${grant.error.message}`);
      }

      const anon = createClient(env!.NEXT_PUBLIC_SUPABASE_URL, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
      const signIn = await anon.auth.signInWithPassword({ email, password });
      if (signIn.error || !signIn.data.session) throw new Error(`signing in e2e user: ${signIn.error?.message}`);

      // Let @supabase/ssr write the cookies exactly as the site would.
      const jar: { name: string; value: string }[] = [];
      const ssr = createServerClient(env!.NEXT_PUBLIC_SUPABASE_URL, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
          getAll: () => [],
          setAll: (list) => {
            jar.push(...list.map(({ name, value }) => ({ name, value })));
          },
        },
      });
      const set = await ssr.auth.setSession({
        access_token: signIn.data.session.access_token,
        refresh_token: signIn.data.session.refresh_token,
      });
      if (set.error) throw new Error(`storing e2e session: ${set.error.message}`);

      return {
        id,
        email,
        password,
        cookies: jar.map((c) => ({ ...c, domain: host, path: "/", sameSite: "Lax" as const })),
        remove,
      };
    } catch (err) {
      await remove();
      throw err;
    }
  }

  /**
   * The one-time code an auth email would carry, without sending one.
   *
   * `generateLink` mints the same token the mail carries and returns it as
   * `email_otp`, so a test can type a REAL code into the form. Nothing is sent,
   * which also keeps the suite clear of the project's email rate limit.
   */
  async function emailCode(email: string, type: "magiclink" | "recovery" = "magiclink"): Promise<string> {
    const { data, error } = await admin.auth.admin.generateLink({ type, email });
    if (error || !data.properties?.email_otp) throw new Error(`minting a code: ${error?.message ?? "no otp"}`);
    return data.properties.email_otp;
  }

  /**
   * The token_hash the "reset your password" email's link carries
   * (/auth/reset/?token_hash=…&type=recovery), minted the same way, unsent.
   */
  async function recoveryHash(email: string): Promise<string> {
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
    if (error || !data.properties?.hashed_token) throw new Error(`minting a reset link: ${error?.message ?? "no hash"}`);
    return data.properties.hashed_token;
  }

  return { createUser, removePurchase, emailCode, recoveryHash, projectHost: new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname };
}
