/**
 * Every entry point in this application must guard itself.
 *
 * Middleware is not a security boundary — two 2026 CVEs let requests skip it
 * (docs/SECURITY.md §3) — so the rule here is that each page, route handler and
 * server-action module calls requireAdmin() or resolveAdmin() in its own code.
 * check-auth-handlers.mjs does the same for the rest of the application. This one
 * is narrower and stricter: under src/app/admin, requireUser() is not enough —
 * being signed in is not being an administrator.
 *
 * It is a text scan, not a type check. That makes it crude, and it makes it very
 * hard to accidentally satisfy: a file either names a guard or it does not.
 *
 * Run by `npm run check`. A new unguarded page fails the build.
 */
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const ROOT = new URL("../src/app/admin", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/* Files that are entry points and so must be guarded. */
const GUARDED = /^(page|route|actions)\.(ts|tsx)$/;

/* Files that legitimately have no guard, and why. */
const EXEMPT = new Map([
  ["layout.tsx", "renders no data of its own"],
  ["not-found.tsx", "is what the guard renders when it refuses"],
  ["globals.css", "a stylesheet"],
  ["robots.ts", "must answer an anonymous crawler"],
]);

const GUARDS = ["requireAdmin(", "resolveAdmin("];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

const files = await walk(ROOT);
const unguarded = [];

for (const path of files) {
  const name = path.split(sep).pop();
  if (EXEMPT.has(name)) continue;
  if (!GUARDED.test(name)) continue;

  const source = readFileSync(path, "utf8");
  if (!GUARDS.some((guard) => source.includes(guard))) {
    unguarded.push(relative(ROOT, path));
  }
}

if (unguarded.length > 0) {
  console.error("Unguarded admin entry points — each must call requireAdmin() or resolveAdmin():");
  for (const path of unguarded) console.error(`  src/app/admin/${path.split(sep).join("/")}`);
  console.error("\nSee docs/ADMIN.md §2. Middleware does not count.");
  process.exit(1);
}

console.warn(`check-admin-guards: ${files.length} files under src/app/admin scanned, every entry point guarded.`);
