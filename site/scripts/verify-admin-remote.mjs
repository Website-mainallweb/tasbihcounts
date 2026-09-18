import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/)
  .filter(l=>/^[A-Z0-9_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,"")];}));

const opts = { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} };
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
const svc  = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, opts);

const out = [];
const pass = (n, ok, d="") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);

// A visitor may read the published names and the switches...
let r = await anon.from("names").select("id").eq("published", true);
pass("anon reads published names", !r.error && r.data.length === 45, r.error?.message ?? `${r.data?.length} rows`);

r = await anon.from("app_flags").select("key, enabled");
pass("anon reads the switches", !r.error && r.data.length === 7, r.error?.message ?? `${r.data?.length} rows`);

// ...and may write neither.
r = await anon.from("names").update({ transliteration: "Hacked" }).eq("id", "radha");
pass("anon cannot rename a name", r.error !== null || (r.data ?? []).length === 0, r.error?.code ?? "no error");

r = await anon.from("app_flags").update({ enabled: false }).eq("key", "ads");
pass("anon cannot throw a switch", r.error !== null || (r.data ?? []).length === 0, r.error?.code ?? "no error");

// The audit log is invisible to anyone but the server.
r = await anon.from("admin_audit").select("id");
pass("anon cannot read the audit log", r.error !== null || (r.data ?? []).length === 0, r.error?.code ?? "empty");

// The admin functions refuse the anon key.
r = await anon.rpc("admin_overview");
pass("anon cannot call admin_overview", r.error !== null, r.error?.code ?? "NO ERROR — BAD");

r = await anon.rpc("admin_grant_entitlement", { target: "00000000-0000-4000-8000-000000000001", plan: "premium_lifetime_v1" });
pass("anon cannot grant premium", r.error !== null, r.error?.code ?? "NO ERROR — BAD");

r = await anon.rpc("admin_set_payment_mode", { new_mode: "live" });
pass("anon cannot change payment mode", r.error !== null, r.error?.code ?? "NO ERROR — BAD");

// The service role can read, and still cannot break the promises.
r = await svc.from("names").delete().eq("id", "radha");
pass("even the server cannot delete a name", r.error !== null, r.error?.message?.slice(0,60) ?? "NO ERROR — BAD");

r = await svc.from("names").update({ id: "radha2" }).eq("id", "radha");
pass("even the server cannot rename an id", r.error !== null, r.error?.message?.slice(0,60) ?? "NO ERROR — BAD");

r = await svc.from("app_flags").insert({ key: "counter", enabled: false, note: "no" });
pass("there is no counter switch to create", r.error !== null, r.error?.code ?? "NO ERROR — BAD");

// The audit log is append-only where it counts.
await svc.from("admin_audit").insert({ actor_email: "probe@test.local", action: "probe.write", subject: "verify" });
r = await svc.from("admin_audit").update({ action: "probe.rewritten" }).eq("action", "probe.write");
pass("the audit log cannot be rewritten", r.error !== null, r.error?.message?.slice(0,60) ?? "NO ERROR — BAD");
r = await svc.from("admin_audit").delete().eq("action", "probe.write");
pass("the audit log cannot be cleared", r.error !== null, r.error?.message?.slice(0,60) ?? "NO ERROR — BAD");

console.log(out.join("\n"));
const failed = out.filter(l => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed}/${out.length} passed`);
process.exit(failed ? 1 : 0);
