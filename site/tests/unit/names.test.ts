import { describe, expect, it } from "vitest";

import { NAMES, nameLabel } from "../../src/lib/counter/names";

describe("nameLabel (#25: Stats showed raw ids)", () => {
  it("uses the library title for a built-in dhikr", () => {
    expect(nameLabel("subhanallah", [])).toBe("SubhanAllah");
    expect(nameLabel("allahu-akbar", [])).toBe("Allahu Akbar");
  });

  it("names a single Name of Allah and a rite, which are not library rows", () => {
    expect(nameLabel("asma-1", [])).not.toBe("asma-1");
    expect(nameLabel("tawaf", [])).not.toBe("tawaf");
  });

  it("uses the person's own words for a custom dhikr", () => {
    const custom = [{ id: "custom-mf3k2a", n: "يا لطيف", t: "Ya Latif", m: "" }];
    expect(nameLabel("custom-mf3k2a", custom)).toBe("Ya Latif");
  });

  it("never shows a custom id, even when its text is on another device", () => {
    expect(nameLabel("custom-mf3k2a", [])).toBe("Your own dhikr");
    expect(nameLabel("custom-mf3k2a", undefined)).toBe("Your own dhikr");
  });

  it("keeps the library intact, in the shape public.names stores", () => {
    expect(NAMES).toHaveLength(14);
    expect(new Set(NAMES.map((n) => n.id)).size).toBe(NAMES.length);
    for (const n of NAMES) {
      expect(n.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(n.n.length).toBeLessThanOrEqual(300);
      expect(n.t.length).toBeLessThanOrEqual(300);
      expect(n.m.length).toBeLessThanOrEqual(300);
    }
  });

  it("keeps every id a practice may already be stored under (ids never change)", () => {
    const ids = new Set(NAMES.map((n) => n.id));
    for (const id of ["subhanallah", "alhamdulillah", "allahu-akbar", "la-ilaha-illallah", "astaghfirullah", "salawat"]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});
