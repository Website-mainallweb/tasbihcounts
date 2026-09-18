/**
 * Throw a kill switch from the command line, for testing the ones the panel sets.
 *
 *   node scripts/flip-flag.mjs ads off
 *   node scripts/flip-flag.mjs maintenance_mode on
 *
 * The panel is the way to do this in earnest — it records who did it and why.
 * This exists so the site's end of the switch can be proved without the panel's
 * password and one-time code, which is the whole point of that password.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/)
  .filter(l=>/^[A-Z0-9_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,"")];}));

const [key, state] = process.argv.slice(2);
if (!key || !["on","off"].includes(state)) {
  console.error("usage: node scripts/flip-flag.mjs <key> <on|off>");
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} });

const { error } = await db.from("app_flags").update({ enabled: state === "on" }).eq("key", key);
if (error) { console.error(error.message); process.exit(1); }

const { data } = await db.from("app_flags").select("key, enabled").order("key");
console.log(data.map(r => `${r.enabled ? "on " : "off"}  ${r.key}`).join("\n"));
