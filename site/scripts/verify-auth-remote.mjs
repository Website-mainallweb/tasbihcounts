/**
 * Signups are closed on the LIVE Supabase project (ARCHITECTURE §6, Phase 8).
 *
 * "Enable signups" is a console setting with no code behind it, so a click six
 * months from now could silently open the door. This checks the setting through
 * the Management API and then tries the doors themselves with the anon key:
 * signUp, and an email sign-in for an address that has no account. Both must be
 * refused. No email is sent — a refused request never reaches the mailer.
 *
 *   npm run verify:auth:remote
 *
 * Needs site/.env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_ACCESS_TOKEN. Prints PASS/FAIL only.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
});
if (res.ok) {
  const c = await res.json();
  check("signups are disabled in the project settings", c.disable_signup === true, String(c.disable_signup));
  check("anonymous sign-ins are off", c.external_anonymous_users_enabled === false);
  check("phone sign-in is off", c.external_phone_enabled === false);
  check("Google sign-in is on", c.external_google_enabled === true);
  check("the redirect allow-list is set", Boolean(c.uri_allow_list), c.uri_allow_list ? "" : "empty");
} else {
  check("Management API readable", false, `HTTP ${res.status}`);
}

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const stranger = `signup-probe-${randomBytes(4).toString("hex")}@example.com`;

const signUp = await anon.auth.signUp({ email: stranger, password: randomBytes(24).toString("base64url") });
check("signUp is refused", Boolean(signUp.error) && !signUp.data?.user, signUp.error?.message ?? "no error");

const otp = await anon.auth.signInWithOtp({ email: stranger, options: { shouldCreateUser: true } });
check("an email sign-in cannot create a user, even when asked to", Boolean(otp.error), otp.error?.message ?? "no error");

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  [${r.detail}]`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
