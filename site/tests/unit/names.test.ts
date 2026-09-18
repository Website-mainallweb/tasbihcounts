import { describe, expect, it } from "vitest";

import { MEANING_HI, NAMES, nameLabel } from "../../src/lib/counter/names";

describe("nameLabel (#25: Stats showed raw ids)", () => {
  it("uses the library title for a built-in name", () => {
    expect(nameLabel("ram", [])).toBe("Ram");
    expect(nameLabel("ram", [], "hi")).toBe("राम");
  });

  it("uses the person's own words for a custom mantra", () => {
    const custom = [{ id: "c1789143769915", n: "ॐ गुरवे नमः", t: "Om Guruve Namah", m: "" }];
    expect(nameLabel("c1789143769915", custom)).toBe("Om Guruve Namah");
    expect(nameLabel("c1789143769915", custom, "hi")).toBe("ॐ गुरवे नमः");
  });

  it("never shows a custom id, even when its text is on another device", () => {
    expect(nameLabel("c1789143769915", [])).toBe("Your own mantra");
    expect(nameLabel("c1789143769915", undefined)).toBe("Your own mantra");
  });

  it("keeps the library intact", () => {
    expect(NAMES).toHaveLength(45);
    expect(new Set(NAMES.map((n) => n.id)).size).toBe(NAMES.length);
  });

  it("keeps every id a practice may already be stored under (ids never change)", () => {
    const ids = new Set(NAMES.map((n) => n.id));
    for (const id of ["ram", "sitaram", "jaishriram", "krishna", "radhe", "radhekrsna", "harekrsna", "govind", "gopal",
      "shiv", "mahadev", "omnamah", "vishnu", "narayan", "omnamona", "vasudev", "hanuman", "omhanu", "ganesh", "omgam",
      "durga", "omdum", "kali", "ambe", "lakshmi", "omshreem", "saraswati", "gayatri", "mahamrityu", "jagannath",
      "balaji", "khatushyam", "sai", "swaminarayan", "dattatreya", "kartikeya", "surya", "om", "shanti"]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("puts the most chanted names first and the mantras together at the end", () => {
    expect(NAMES.slice(0, 9).map((n) => n.id)).toEqual([
      "radha", "shriradha", "radhe", "shiv", "sambsadashiv", "mahadev", "harharmahadev", "hanuman", "shriram",
    ]);
    const firstMantra = NAMES.findIndex((n) => n.g === "mantra");
    expect(NAMES.slice(firstMantra).every((n) => n.g === "mantra")).toBe(true);
    expect(NAMES.every((n) => MEANING_HI[n.id])).toBe(true);
  });
});
