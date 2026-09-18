import { describe, expect, it } from "vitest";

import {
  bucketLabel,
  fmtMeasure,
  fmtNum,
  langOf,
  monthTitle,
  numeralsOf,
  rangeLabel,
  tr,
} from "../../src/lib/counter/page-lang";

/** Hindi on Streak and Stats (UX walkthrough #16/#29). */

describe("what the counter saved", () => {
  it("falls back to English and Latin digits", () => {
    expect(langOf(null)).toBe("en");
    expect(langOf({})).toBe("en");
    expect(numeralsOf(null)).toBe("latin");
    expect(numeralsOf({ numerals: "latin" })).toBe("latin");
  });

  it("follows the counter's own settings, spelled the way the engine writes them", () => {
    expect(langOf({ lang: "hi" })).toBe("hi");
    // The engine stores "deva", not "dev".
    expect(numeralsOf({ numerals: "deva" })).toBe("deva");
  });
});

describe("numbers", () => {
  it("groups the Indian way", () => {
    expect(fmtNum(100000)).toBe("1,00,000");
  });

  it("uses Devanagari digits when the counter is set to them", () => {
    expect(fmtNum(108, "deva")).toBe("१०८");
  });

  it("translates the unit on a stretch of time", () => {
    // The space matches how the counter itself writes it.
    expect(fmtMeasure(90 * 60_000, "time", "hi", "latin")).toBe("1.5 घं");
    expect(fmtMeasure(5 * 60_000, "time", "hi", "deva")).toBe("५ मि");
    expect(fmtMeasure(1008, "count", "en", "latin")).toBe("1,008");
  });
});

describe("labels", () => {
  it("names the month in the reader's language", () => {
    expect(monthTitle(2026, 9, "en", "latin")).toBe("September 2026");
    expect(monthTitle(2026, 9, "hi", "deva")).toBe("सितम्बर २०२६");
  });

  it("translates a bar label that is a weekday or a month", () => {
    expect(bucketLabel("Mon", "hi", "latin")).toBe("सोम");
    expect(bucketLabel("Sep", "hi", "latin")).toBe("सित");
    expect(bucketLabel("2026", "hi", "deva")).toBe("२०२६");
  });

  it("translates the months inside a range and leaves the rest alone", () => {
    expect(rangeLabel("7 Sep – 13 Sep", "hi", "latin")).toBe("7 सित – 13 सित");
    expect(rangeLabel("2022 – 2026", "hi", "deva")).toBe("२०२२ – २०२६");
    expect(rangeLabel("7 Sep – 13 Sep", "en", "latin")).toBe("7 Sep – 13 Sep");
    // B49: English month names keep 0–9, even with Devanagari numerals chosen.
    expect(rangeLabel("7 Sep – 13 Sep", "en", "deva")).toBe("7 Sep – 13 Sep");
  });

  it("keeps English as the fallback", () => {
    expect(tr("en", "streak")).toBe("Streak");
    expect(tr("hi", "streak")).not.toBe("Streak");
  });
});
