/**
 * The JavaScript a page makes a visitor download before it works, gzipped, held
 * under a budget (ARCHITECTURE §6, Phase 12).
 *
 * The counter is the product and it is tapped on cheap phones on slow networks.
 * Every Premium feature — sign-in, sync, reminders, checkout — was built to load
 * only when used; this is what proves it stayed that way. Two checks:
 *
 *   1. first-load JS per prerendered page stays within its budget
 *   2. no first-load chunk carries the Supabase client, Firebase, or (outside
 *      /premium/) Razorpay's checkout — those must arrive by dynamic import
 *
 * Reads the production build. Next 16 no longer writes app-build-manifest.json,
 * so the source of truth is what a browser actually gets: the <script src> tags
 * in each prerendered page's HTML. nomodule scripts are left out — a modern
 * browser never downloads them. Dynamic routes (/login/, /account/, /admin/) have
 * no prerendered HTML and are not measured here.
 *
 *   node scripts/check-bundle.mjs            check budgets and markers
 *   node scripts/check-bundle.mjs --report   print sizes, check nothing
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const next = join(root, ".next");
const app = join(next, "server", "app");

/**
 * Gzipped KB. Set on 2026-09-11 from the first measured build (/ 167.3, /stats/
 * 148.4, /premium/ 146.7, /streak/ 145.4, content pages ~144.2) plus a small
 * margin — then only ever lowered on purpose.
 */
/* 2026-09-13: "/" 175 → 176, for what Rajan asked the counter to gain — six more
   names and a mantra-jap group in both languages, Today/Mala/Total above the ring
   and History's View all. The redesign's own chrome (drawer, popup, toast) was made
   lazy to stay inside the old budget; only this content went over, by 0.2 KB. */
/* 2026-09-13, bug-hunt fixes: "/" 176 → 177 and "/stats/" 155 → 156. The fixes
   themselves (the counter's mala, target, timer and keyboard bugs; the stats
   placeholder that stopped the layout jumping; labelled fields and a real
   favourite button) went over by 0.4 KB each, after the header's new background
   work was moved to an idle chunk (lib/header-idle.ts) to win back what it could. */
export const BUDGETS = { "/": 177, "/stats/": 156, "/streak/": 155, "/premium/": 155 };
export const DEFAULT_BUDGET = 150;

/** Strings that exist only inside a library that must never load up front. */
export const FORBIDDEN = [
  { marker: "GoTrueClient", what: "the Supabase auth client" },
  { marker: "PostgrestClient", what: "the Supabase data client" },
  { marker: "RealtimeClient", what: "the Supabase realtime client" },
  { marker: "FirebaseError", what: "the Firebase SDK" },
  { marker: "checkout.razorpay.com/v1/checkout.js", what: "Razorpay checkout", except: ["/premium/"] },
];

export const routeOf = (file) => (file === "index.html" ? "/" : `/${file.replace(/\.html$/, "")}/`);

/** First-load module scripts named in a page's HTML. */
export function scriptsIn(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="\/_next\/(static\/[^"]+\.js)"[^>]*>/g)]
    .filter((m) => !/\bnomodule\b/i.test(m[0]))
    .map((m) => m[1]);
}

export function measure() {
  if (!existsSync(app)) throw new Error("No .next/server/app — run `next build` first.");
  const cache = new Map();
  const load = (file) => {
    if (!cache.has(file)) {
      const body = readFileSync(join(next, file));
      cache.set(file, { gz: gzipSync(body).length, text: body.toString("utf8") });
    }
    return cache.get(file);
  };

  const out = [];
  for (const file of readdirSync(app).filter((f) => f.endsWith(".html") && !f.startsWith("_")).sort()) {
    const route = routeOf(file);
    const scripts = [...new Set(scriptsIn(readFileSync(join(app, file), "utf8")))];
    let bytes = 0;
    const found = [];
    for (const s of scripts) {
      const { gz, text } = load(s);
      bytes += gz;
      for (const f of FORBIDDEN) {
        if (!f.except?.includes(route) && text.includes(f.marker)) found.push(`${f.what} (${s})`);
      }
    }
    out.push({ route, bytes, scripts: scripts.length, found });
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const pages = measure();
  const kb = (b) => (b / 1024).toFixed(1);

  if (process.argv.includes("--report")) {
    for (const p of pages) console.log(`${kb(p.bytes).padStart(7)} KB  ${p.route}${p.found.length ? `  !! ${p.found.join("; ")}` : ""}`);
    process.exit(0);
  }

  const problems = [];
  for (const p of pages) {
    const budget = BUDGETS[p.route] ?? DEFAULT_BUDGET;
    if (p.bytes / 1024 > budget) problems.push(`${p.route}: ${kb(p.bytes)} KB gzipped, budget ${budget} KB`);
    for (const f of p.found) problems.push(`${p.route}: first load carries ${f}`);
  }
  if (problems.length) {
    console.error("Bundle budget:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log(`bundle budget: ${pages.length} prerendered pages within budget, no Premium library on first load`);
}
