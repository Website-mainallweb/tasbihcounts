import { describe, expect, test } from "vitest";

// A plain .mjs build script, imported for its pure function.
import { problemsIn } from "../../scripts/check-auth-handlers.mjs";

/**
 * The guard that makes "every handler calls requireUser()" a build failure
 * rather than a promise (ARCHITECTURE §6, Phase 7).
 */

const route = "src/app/api/sync/route.ts";

describe("route handlers", () => {
  test("a guarded handler passes", () => {
    const src = `
      import { requireBearerUser } from "@/lib/dal";
      export async function POST(req: Request) {
        const { supabase } = await requireBearerUser(req);
        return Response.json({ ok: true });
      }`;
    expect(problemsIn(route, src)).toEqual([]);
  });

  test("an unguarded handler fails", () => {
    const src = `export async function POST() { return Response.json({ ok: true }); }`;
    expect(problemsIn(route, src)).toEqual([`${route}: POST does not call requireUser() or requireBearerUser()`]);
  });

  test("each method is checked on its own: a guarded GET does not cover POST", () => {
    const src = `
      export async function GET() { await requireUser(); return new Response("ok"); }
      export async function POST() { return new Response("ok"); }`;
    expect(problemsIn(route, src)).toEqual([`${route}: POST does not call requireUser() or requireBearerUser()`]);
  });

  test("a guard that is only in a comment does not count", () => {
    const src = `
      export async function POST() {
        // await requireUser();
        /* requireBearerUser(req) */
        return new Response("ok");
      }`;
    expect(problemsIn(route, src)).toHaveLength(1);
  });

  test("a handler exported as a variable is refused, since it cannot be checked", () => {
    const src = `export const POST = async () => new Response("ok");`;
    expect(problemsIn(route, src)).toEqual([
      `${route}: POST is exported as a variable; write it as a function so its guard can be checked`,
    ]);
  });

  test("helpers that are not HTTP methods are not handlers", () => {
    const src = `
      export const dynamic = "force-dynamic";
      export function helper() { return 1; }
      export async function GET() { await requireUser(); return new Response("ok"); }`;
    expect(problemsIn(route, src)).toEqual([]);
  });
});

describe("server actions", () => {
  const actions = "src/app/settings/actions.ts";

  test("every exported function in a \"use server\" file needs its own guard", () => {
    const src = `"use server";
      export async function save() { await requireUser(); }
      export async function erase() { }`;
    expect(problemsIn(actions, src)).toEqual([`${actions}: erase does not call requireUser() or requireBearerUser()`]);
  });

  test("an admin action guarded only by requireAdmin() passes, because requireAdmin() calls requireUser()", () => {
    const src = `"use server";
      export async function rerun(formData: FormData) { await requireAdmin(); }`;
    expect(problemsIn("src/app/admin/actions.ts", src)).toEqual([]);
  });

  test("files that are neither routes nor actions are ignored", () => {
    expect(problemsIn("src/lib/nav.ts", "export function isSheet() { return true; }")).toEqual([]);
  });
});

describe("a handler whose parameters are destructured", () => {
  /*
   * Next passes route params as a second argument that is almost always
   * destructured. The scanner used to take the first "{" after the function name
   * as the body, which for these is the parameter object — so it searched the
   * parameters for a guard, found none, and reported a guarded route as
   * unguarded. The same mistake in the other direction would have passed an
   * unguarded one, which is why this is worth a test of its own.
   */
  const guarded = `
    import { requireAdmin } from "@/lib/admin";
    export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
      await requireAdmin();
      const { id } = await params;
      return Response.json({ id });
    }
  `;

  const unguarded = `
    export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
      const { id } = await params;
      return Response.json({ id });
    }
  `;

  test("is accepted when it does guard itself", () => {
    expect(problemsIn("src/app/admin/users/[id]/export/route.ts", guarded)).toEqual([]);
  });

  test("is still caught when it does not", () => {
    expect(problemsIn("src/app/admin/users/[id]/export/route.ts", unguarded)).toHaveLength(1);
  });
});
