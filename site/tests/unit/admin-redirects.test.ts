import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * Every path the admin panel sends somebody to stays inside /admin.
 *
 * The panel's URLs had no prefix when it was a separate application; folding it
 * into this one rewrote them, and two kinds of thing were missed.
 *
 * A multi-line `back(\n  "/names/new/",` sent the operator to a 404 — but only on
 * the path that hits it, "you typed an id that already exists". The sort of
 * thing found by a stranger, months later.
 *
 * And the pagers linked to `/users/?page=2`, which **worked** — the proxy
 * rewrites a bare path on the admin host onto /admin anyway. Working by accident
 * is worth failing a build over: the accident ends the day anything else reaches
 * those pages.
 *
 * This reads the source rather than exercising each screen. The actions take a
 * FormData and redirect, and the pages need a session, so driving them all would
 * mean a pile of fixtures to learn something a string can answer.
 */

const ADMIN = fileURLToPath(new URL("../../src/app/admin", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

const REDIRECT = /\b(?:redirect|back)\(\s*(["'`])([^"'`]*)\1/g;
const HREF = /href=\{?(["'`])(\/[^"'`]*)\1/g;
/** Helpers that build a path and return it, like the pagers' link(). */
const RETURNED_PATH = /return [^;\n]*?(["'`])(\/[a-z][^"'`]*)\1/g;

const matches = (source: string, re: RegExp): string[] =>
  [...source.matchAll(re)].map((m) => m[2]);

const label = (file: string) => file.slice(file.indexOf("src")).split("\\").join("/");

describe("admin redirects", () => {
  const actions = walk(ADMIN).filter((f) => f.endsWith("actions.ts"));

  test("there are actions to check", () => {
    expect(actions.length).toBeGreaterThan(3);
  });

  test.each(actions.map((f) => [label(f), f] as const))(
    "%s only sends people into /admin",
    (name, file) => {
      const targets = matches(readFileSync(file, "utf8"), REDIRECT);
      // A relative target, or one built entirely from a variable, is not this
      // test's business. An absolute path is.
      for (const target of targets.filter((t) => t.startsWith("/"))) {
        expect(target, `${name} redirects to ${target}`).toMatch(/^\/admin(\/|$)/);
      }
    },
  );
});

describe("admin links", () => {
  const screens = walk(ADMIN).filter((f) => f.endsWith(".tsx"));

  test("there are screens to check", () => {
    expect(screens.length).toBeGreaterThan(10);
  });

  test.each(screens.map((f) => [label(f), f] as const))("%s only links into /admin", (name, file) => {
    const source = readFileSync(file, "utf8");
    for (const href of [...matches(source, HREF), ...matches(source, RETURNED_PATH)]) {
      expect(href, `${name} links to ${href}`).toMatch(/^\/admin(\/|$)/);
    }
  });
});
