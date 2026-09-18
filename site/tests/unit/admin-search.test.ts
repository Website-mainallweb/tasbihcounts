import { describe, expect, test } from "vitest";

import { purchaseSearch } from "@/lib/admin/db";

/**
 * What the Payments search box does with what you type.
 *
 * This exists because of one character: the term used to be `.toLowerCase()`d
 * before being matched. Razorpay's ids are mixed case —
 * `order_TbQZU3nBDKO0u7` — so an exact match against a lower-cased copy matched
 * nothing, every time, and the screen said "0 matching" rather than erroring.
 * The commonest thing support does, quietly broken, and nothing in the build
 * would ever have noticed.
 */

describe("an order id", () => {
  test("is matched exactly, with its capitals intact", () => {
    expect(purchaseSearch("order_TbQZU3nBDKO0u7")).toEqual({ orderId: "order_TbQZU3nBDKO0u7" });
  });

  test("survives being pasted with spaces around it", () => {
    expect(purchaseSearch("  order_TbQZU3nBDKO0u7  ")).toEqual({ orderId: "order_TbQZU3nBDKO0u7" });
  });

  test("is recognised in any casing Razorpay might use", () => {
    for (const id of ["order_ABCDEFGH", "order_abcdefgh", "order_AbC123xyz"]) {
      expect(purchaseSearch(id), id).toEqual({ orderId: id });
    }
  });
});

describe("anything else", () => {
  test("is treated as part of an email", () => {
    expect(purchaseSearch("rajan@example.com")).toEqual({ email: "rajan@example.com" });
    expect(purchaseSearch("rajan")).toEqual({ email: "rajan" });
  });

  test("keeps its case, because ilike does not care", () => {
    expect(purchaseSearch("Rajan@Example.com")).toEqual({ email: "Rajan@Example.com" });
  });

  test("something that only looks like an order id is an email search", () => {
    // Too short for the pattern, so it must not become an exact id match that
    // finds nothing.
    expect(purchaseSearch("order_abc")).toEqual({ email: "order_abc" });
  });
});

describe("nothing typed", () => {
  test.each([undefined, "", "   "])("%p searches for nothing at all", (raw) => {
    expect(purchaseSearch(raw)).toEqual({});
  });
});
