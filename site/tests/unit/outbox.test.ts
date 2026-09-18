import { describe, expect, it } from "vitest";

import {
  type Outbox,
  type Watermark,
  acknowledge,
  canUndo,
  isEmpty,
  keyOf,
  mark,
  pending,
  readOutbox,
  readWatermark,
  undoableCount,
} from "../../src/lib/counter/outbox";

const DAY = "2026-09-09";
const OTHER = "2026-09-10";

describe("mark", () => {
  it("keys by day and name, so neither can overwrite the other", () => {
    let o: Outbox = {};
    o = mark(o, DAY, "ram", { c: 10, r: 0, s: 0 });
    o = mark(o, DAY, "shiva", { c: 5, r: 0, s: 0 });
    o = mark(o, OTHER, "ram", { c: 3, r: 0, s: 0 });

    expect(pending(o)).toHaveLength(3);
    expect(o[keyOf(DAY, "ram")].c).toBe(10);
    expect(o[keyOf(DAY, "shiva")].c).toBe(5);
    expect(o[keyOf(OTHER, "ram")].c).toBe(3);
  });

  it("survives midnight without losing the day that was pending", () => {
    // The single-record design lost this: yesterday's unsent work was replaced
    // by today's the moment the clock rolled over.
    let o = mark({}, DAY, "ram", { c: 108, r: 1, s: 300 });
    o = mark(o, OTHER, "ram", { c: 1, r: 0, s: 0 });
    expect(o[keyOf(DAY, "ram")]).toMatchObject({ c: 108, r: 1 });
  });

  it("bumps the version each time the value moves", () => {
    let o = mark({}, DAY, "ram", { c: 1, r: 0, s: 0 });
    expect(o[keyOf(DAY, "ram")].version).toBe(1);
    o = mark(o, DAY, "ram", { c: 2, r: 0, s: 0 });
    expect(o[keyOf(DAY, "ram")].version).toBe(2);
  });

  it("does not churn the version when nothing changed", () => {
    const o = mark({}, DAY, "ram", { c: 5, r: 0, s: 0 });
    expect(mark(o, DAY, "ram", { c: 5, r: 0, s: 0 })).toBe(o);
  });

  it("follows an undo down, so a tap taken back before it was sent is never uploaded", () => {
    let o = mark({}, DAY, "ram", { c: 50, r: 2, s: 100 });
    o = mark(o, DAY, "ram", { c: 49, r: 2, s: 100 });
    expect(o[keyOf(DAY, "ram")]).toMatchObject({ c: 49, r: 2, s: 100, version: 2 });
  });

  it("cannot be undone below what the server confirmed, which is what keeps lowering safe", () => {
    let o = mark({}, DAY, "ram", { c: 50, r: 0, s: 0 });
    const { watermark } = acknowledge(o, {}, [{ key: keyOf(DAY, "ram"), version: 1, confirmed: { c: 50, r: 0, s: 0 } }]);
    expect(canUndo(watermark, DAY, "ram", 50)).toBe(false);
    o = mark(o, DAY, "ram", { c: 51, r: 0, s: 0 });
    expect(canUndo(watermark, DAY, "ram", 51)).toBe(true);
  });

  it("ignores rubbish values", () => {
    const o = mark({}, DAY, "ram", {
      c: Number.NaN,
      r: -5,
      s: Number.POSITIVE_INFINITY,
    });
    expect(o[keyOf(DAY, "ram")]).toMatchObject({ c: 0, r: 0, s: 0 });
  });
});

describe("acknowledge", () => {
  it("clears an entry the server confirmed at the version that was sent", () => {
    const o = mark({}, DAY, "ram", { c: 10, r: 0, s: 0 });
    const k = keyOf(DAY, "ram");
    const r = acknowledge(o, {}, [
      { key: k, version: 1, confirmed: { c: 10, r: 0, s: 0 } },
    ]);
    expect(isEmpty(r.outbox)).toBe(true);
    expect(r.watermark[k]).toEqual({ c: 10, r: 0, s: 0 });
  });

  it("keeps the entry dirty when taps happened while the request was in flight", () => {
    let o = mark({}, DAY, "ram", { c: 10, r: 0, s: 0 });
    o = mark(o, DAY, "ram", { c: 14, r: 0, s: 0 }); // four more taps, version 2
    const k = keyOf(DAY, "ram");

    const r = acknowledge(o, {}, [
      { key: k, version: 1, confirmed: { c: 10, r: 0, s: 0 } },
    ]);
    // The reply is for a value that is no longer current; those four taps have
    // not been uploaded and must go again.
    expect(r.outbox[k].c).toBe(14);
    expect(r.watermark[k].c).toBe(10);
  });

  it("never walks the watermark backwards on an out-of-order reply", () => {
    const k = keyOf(DAY, "ram");
    const start: Watermark = { [k]: { c: 100, r: 1, s: 50 } };
    const r = acknowledge({}, start, [
      { key: k, version: 1, confirmed: { c: 20, r: 0, s: 10 } },
    ]);
    expect(r.watermark[k]).toEqual({ c: 100, r: 1, s: 50 });
  });

  it("leaves other keys alone", () => {
    let o = mark({}, DAY, "ram", { c: 10, r: 0, s: 0 });
    o = mark(o, DAY, "shiva", { c: 7, r: 0, s: 0 });
    const r = acknowledge(o, {}, [
      { key: keyOf(DAY, "ram"), version: 1, confirmed: { c: 10, r: 0, s: 0 } },
    ]);
    expect(r.outbox[keyOf(DAY, "shiva")].c).toBe(7);
  });
});

describe("undo against the watermark", () => {
  it("allows everything while nothing has been confirmed — today's behaviour", () => {
    expect(canUndo({}, DAY, "ram", 50)).toBe(true);
    expect(undoableCount({}, DAY, "ram", 50)).toBe(50);
  });

  it("allows only the taps the server has not seen", () => {
    const w: Watermark = { [keyOf(DAY, "ram")]: { c: 40, r: 0, s: 0 } };
    expect(undoableCount(w, DAY, "ram", 47)).toBe(7);
    expect(canUndo(w, DAY, "ram", 47)).toBe(true);
  });

  it("refuses at the boundary, because GREATEST would bring the tap back", () => {
    const w: Watermark = { [keyOf(DAY, "ram")]: { c: 40, r: 0, s: 0 } };
    expect(undoableCount(w, DAY, "ram", 40)).toBe(0);
    expect(canUndo(w, DAY, "ram", 40)).toBe(false);
  });

  it("does not go negative if the local value somehow trails the watermark", () => {
    const w: Watermark = { [keyOf(DAY, "ram")]: { c: 90, r: 0, s: 0 } };
    expect(undoableCount(w, DAY, "ram", 10)).toBe(0);
  });

  it("tracks each name separately", () => {
    const w: Watermark = { [keyOf(DAY, "ram")]: { c: 40, r: 0, s: 0 } };
    expect(canUndo(w, DAY, "shiva", 3)).toBe(true);
  });
});

describe("reading back from storage", () => {
  it("round-trips through JSON", () => {
    let o = mark({}, DAY, "ram", { c: 10, r: 1, s: 60 });
    o = mark(o, OTHER, "shiva", { c: 4, r: 0, s: 5 });
    expect(readOutbox(JSON.parse(JSON.stringify(o)))).toEqual(o);
  });

  it("treats anything that is not an object as empty", () => {
    for (const junk of [null, undefined, "x", 42, [1, 2]]) {
      expect(readOutbox(junk)).toEqual({});
      expect(readWatermark(junk)).toEqual({});
    }
  });

  it("drops entries missing the fields that identify them", () => {
    const o = readOutbox({
      good: { day: DAY, naamId: "ram", c: 1, r: 0, s: 0, version: 1 },
      bad: { c: 5 },
      worse: "nope",
    });
    expect(Object.keys(o)).toEqual(["good"]);
  });

  it("repairs negative or non-numeric counts", () => {
    const o = readOutbox({
      k: { day: DAY, naamId: "ram", c: -4, r: "x", s: null, version: 2 },
    });
    expect(o.k).toMatchObject({ c: 0, r: 0, s: 0, version: 2 });
  });
});
