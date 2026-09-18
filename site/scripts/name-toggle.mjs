import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/)
  .filter(l=>/^[A-Z0-9_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,"")];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} });
const [id, state] = process.argv.slice(2);
const { error } = await db.from("names").update({ published: state === "show" }).eq("id", id);
if (error) { console.error(error.message); process.exit(1); }
const { data } = await db.from("names").select("id,transliteration,published").eq("id", id);
console.log(JSON.stringify(data[0]));
