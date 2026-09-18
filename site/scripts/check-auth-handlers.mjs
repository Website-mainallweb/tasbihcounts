/**
 * Every route handler and every server action resolves its user itself.
 *
 * docs/SECURITY.md §3: middleware can be skipped, and "use server" adds no
 * authentication — a server action is a public POST endpoint. So each exported
 * HTTP method in a route.ts, and each exported function in a "use server" file,
 * must call requireUser() or requireBearerUser() in its own body.
 *
 * The check is per function, not per file: a file where GET is guarded and POST
 * is not is exactly the mistake this exists to catch.
 *
 *   node scripts/check-auth-handlers.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * requireAdmin is requireUser plus "and that email is in ADMIN_EMAILS", so it is
 * strictly stronger. resolveAdmin is the same three checks without the redirect,
 * for the callers that have to tell "signed out" from "not an administrator"
 * rather than be redirected by the difference (docs/ADMIN.md §2).
 */
const GUARD = /\b(requireUser|requireBearerUser|requireAdmin|resolveAdmin)\s*\(/;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/**
 * Handlers that are right not to have a user, each with the reason. The Razorpay
 * webhook will go here in Phase 9: it has no session, and verifies the HMAC
 * signature over the raw body before reading anything instead.
 */
export const ALLOWED = {
  "src/app/admin/login/actions.ts":
    "Signing out of the admin panel. It ends whatever session the browser has and redirects; requiring a user first would mean a half-broken session could not be cleared. alreadyIn() next to it does call resolveAdmin().",
  "src/app/(site)/auth/callback/route.ts":
    "Runs before there is a user: it exchanges Supabase's one-time code for a session cookie and redirects. It reads no data; the page it sends to verifies the user.",
  "src/app/api/checkout/order/route.ts":
    "Pay-first: the account does not exist until the payment does. Creates an order and our purchase row; grants nothing. Same-site Origin required, 5 orders per email per hour.",
  "src/app/api/checkout/verify/route.ts":
    "The buyer has no account yet. Checks Razorpay's checkout signature, then reconcile() reads the payment from Razorpay's API; nothing the browser says is trusted.",
  "src/app/api/checkout/status/route.ts":
    "The buyer has no account yet. Returns only the purchase state for an unguessable order id; reconcile() believes only Razorpay's API.",
  "src/app/api/razorpay/webhook/route.ts":
    "No user session exists in a webhook. The HMAC signature over the raw body, checked in constant time before anything else, is the authentication.",
  "src/app/api/auth/password/route.ts":
    "This IS the sign-in: there is no user until it succeeds. Supabase checks the password; the attempt is counted per address and per network (lib/auth-throttle.ts) and every refusal answers the same way.",
  "src/app/api/auth/recover/route.ts":
    "\"I forgot my password\", from someone who cannot sign in. It only asks Supabase to send that address its own reset mail, answers the same whether or not the account exists, and is throttled like the sign-in route.",
  "src/app/api/auth/reset/route.ts":
    "Setting a new password from the reset email, by someone who cannot sign in. The one-time recovery token is the proof and Supabase verifies it; without one, only a recovery session under 15 minutes old is accepted, so a signed-in browser cannot skip the current password. Throttled per network and per address.",
  "src/app/api/auth/otp/route.ts":
    "Asking for the sign-in email, from someone who is not signed in — that is the point of it. It only asks Supabase to mail that address its own one-time link and code, never creates a user (shouldCreateUser: false), answers the same whether or not the account exists, and is throttled per address and per network so nobody can burn the project's mail allowance.",
  "src/app/api/cron/reminders/route.ts":
    "A scheduled job, not a user: pg_cron calls it with the CRON_SECRET bearer, checked in constant time before anything else. It reads and writes through the service role only.",
};

/** Comments removed, so a commented-out call does not count as a guard. */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/**
 * The body of the function whose parameter list opens at `paren`.
 *
 * It skips the parameters first. Taking the next "{" after the name found the
 * DESTRUCTURING brace for a handler written
 * `GET(request, { params }: { params: Promise<…> })` — so the "body" being
 * searched for a guard was the parameter object, which contains no guard and
 * never could. That reported a guarded route as unguarded; the same mistake the
 * other way would have passed an unguarded one.
 */
function bodyFrom(text, paren) {
  let parens = 0;
  let after = -1;
  for (let i = paren; i < text.length; i++) {
    if (text[i] === "(") parens++;
    else if (text[i] === ")" && --parens === 0) { after = i + 1; break; }
  }
  if (after === -1) return "";

  const open = text.indexOf("{", after);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/**
 * @param {string} path repo-relative, forward slashes
 * @param {string} source
 * @returns {string[]} one problem per unguarded export
 */
export function problemsIn(path, source) {
  const text = stripComments(source);
  const isRoute = /(^|\/)route\.(t|j)sx?$/.test(path);
  const isAction = /^\s*(["'])use server\1/.test(text);
  if (!isRoute && !isAction) return [];
  if (Object.hasOwn(ALLOWED, path)) return [];

  const problems = [];
  const wanted = (name) => (isRoute ? METHODS.has(name) : true);

  // export const POST = ... cannot be checked reliably; ask for a function.
  for (const m of text.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    if (wanted(m[1])) {
      problems.push(`${path}: ${m[1]} is exported as a variable; write it as a function so its guard can be checked`);
    }
  }

  for (const m of text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/g)) {
    const name = m[1] ?? "default";
    if (!wanted(name)) continue;
    // m[0] ends at the opening paren of the parameter list.
    const body = bodyFrom(text, m.index + m[0].length - 1);
    if (!GUARD.test(body)) {
      problems.push(`${path}: ${name} does not call requireUser() or requireBearerUser()`);
    }
  }

  return problems;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(t|j)sx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const problems = walk(join(root, "src")).flatMap((file) =>
    problemsIn(relative(root, file).split(sep).join("/"), readFileSync(file, "utf8")),
  );
  if (problems.length) {
    console.error("Unguarded handlers:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log("auth handlers: every route and server action resolves its user");
}
