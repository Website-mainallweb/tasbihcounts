import { describe, expect, it } from "vitest";

import {
  type History,
  buildPeriod,
  canGoBack,
  canGoForward,
  firstRecordedDay,
  formatDuration,
  formatValue,
  hasNameBreakdown,
  namesInHistory,
} from "../../src/lib/counter/stats";

/** Wednesday. */
const TODAY = "2026-09-09";

/** A day with a breakdown: the parts add up to the whole. */
const day = (parts: Record<string, [number, number]>) => {
  const n: Record<string, { c: number; r: number; s: number }> = {};
  let c = 0;
  let s = 0;
  for (const [id, [count, ms]] of Object.entries(parts)) {
    n[id] = { c: count, r: Math.floor(count / 108), s: ms };
    c += count;
    s += ms;
  }
  return { c, r: Math.floor(c / 108), s, n };
};

/** A day from before the breakdown existed. */
const legacyDay = (c: number, s = 60_000) => ({ c, r: Math.floor(c / 108), s });

describe("namesInHistory", () => {
  it("lists every name, most chanted first", () => {
    const hist: History = {
      "2026-09-08": day({ ram: [100, 1000], shiva: [300, 2000] }),
      "2026-09-09": day({ ram: [500, 1000] }),
    };
    expect(namesInHistory(hist)).toEqual([
      { id: "ram", total: 600 },
      { id: "shiva", total: 300 },
    ]);
  });

  it("is empty when nothing has a breakdown", () => {
    expect(namesInHistory({ "2026-09-09": legacyDay(108) })).toEqual([]);
    expect(hasNameBreakdown({ "2026-09-09": legacyDay(108) })).toBe(false);
    expect(hasNameBreakdown({ "2026-09-09": day({ ram: [1, 1] }) })).toBe(true);
  });
});

describe("daily", () => {
  const hist: History = {
    "2026-09-07": day({ ram: [108, 300_000] }),
    "2026-09-09": day({ ram: [216, 600_000], shiva: [54, 120_000] }),
    // Last week, so out of range at offset 0.
    "2026-09-02": day({ ram: [1000, 900_000] }),
  };

  it("runs Monday to Sunday and marks today", () => {
    const p = buildPeriod(hist, { grain: "daily", metric: "count", today: TODAY });
    expect(p.buckets).toHaveLength(7);
    expect(p.buckets.map((b) => b.label)).toEqual([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    ]);
    expect(p.buckets[0].key).toBe("2026-09-07");
    expect(p.buckets.filter((b) => b.isNow)).toHaveLength(1);
    expect(p.label).toBe("7 Sep – 13 Sep");
  });

  it("totals only the week in view", () => {
    const p = buildPeriod(hist, { grain: "daily", metric: "count", today: TODAY });
    expect(p.total).toBe(108 + 270);
    expect(p.activeBuckets).toBe(2);
  });

  it("steps back a week", () => {
    const p = buildPeriod(hist, {
      grain: "daily",
      metric: "count",
      offset: -1,
      today: TODAY,
    });
    expect(p.total).toBe(1000);
    expect(p.label).toBe("31 Aug – 6 Sep");
  });

  it("averages over the days that have happened, not the whole week", () => {
    // Wednesday: three days in, not seven. Dividing by seven would understate
    // the practice by more than half and read as a slump that is not there.
    const p = buildPeriod(hist, { grain: "daily", metric: "count", today: TODAY });
    expect(p.perDay).toBe(Math.round(378 / 3));
  });

  it("averages over the days since the practice began, once the week is over", () => {
    // The first record ever is Wednesday 2 Sep: Monday and Tuesday of that week
    // came before the practice existed, so they do not dilute it (#06).
    const p = buildPeriod(hist, {
      grain: "daily",
      metric: "count",
      offset: -1,
      today: TODAY,
    });
    expect(p.perDay).toBe(Math.round(1000 / 5));
  });

  it("averages over all seven days of a finished week the practice had already reached", () => {
    const older: History = { ...hist, "2026-08-01": day({ ram: [7, 0] }) };
    const p = buildPeriod(older, { grain: "daily", metric: "count", offset: -1, today: TODAY });
    expect(p.perDay).toBe(Math.round(1000 / 7));
  });

  it("averages a year over calendar days, not over days with a record", () => {
    // The first record is 2 Sep: eight calendar days to today, though only three
    // of them have a record. Dividing by three was "per practised day" (#06).
    const p = buildPeriod(hist, { grain: "monthly", metric: "count", today: TODAY });
    expect(p.total).toBe(1000 + 108 + 270);
    expect(p.perDay).toBe(Math.round((1000 + 108 + 270) / 8));
  });

  it("does not show years before the practice began (#34)", () => {
    const p = buildPeriod(hist, { grain: "yearly", metric: "count", today: TODAY });
    expect(p.buckets.map((b) => b.label)).toEqual(["2026"]);
    expect(p.label).toBe("2026");
  });

  it("measures time as well as chants", () => {
    const p = buildPeriod(hist, { grain: "daily", metric: "time", today: TODAY });
    expect(p.total).toBe(300_000 + 720_000);
  });
});

describe("the name filter", () => {
  const hist: History = {
    "2026-09-09": day({ ram: [216, 600_000], shiva: [54, 120_000] }),
  };

  it("counts one name", () => {
    const all = buildPeriod(hist, { grain: "daily", metric: "count", today: TODAY });
    const ram = buildPeriod(hist, {
      grain: "daily",
      metric: "count",
      name: "ram",
      today: TODAY,
    });
    expect(all.total).toBe(270);
    expect(ram.total).toBe(216);
  });

  it("is zero for a name never chanted", () => {
    const p = buildPeriod(hist, {
      grain: "daily",
      metric: "count",
      name: "krishna",
      today: TODAY,
    });
    expect(p.total).toBe(0);
  });

  it("says when days in range cannot be attributed", () => {
    // Days recorded before the breakdown existed hold a total and nothing else.
    // Silently leaving them out of a filtered view would make the number look
    // like a drop in practice rather than a gap in the record.
    const mixed: History = { ...hist, "2026-09-08": legacyDay(500) };
    const filtered = buildPeriod(mixed, {
      grain: "daily",
      metric: "count",
      name: "ram",
      today: TODAY,
    });
    expect(filtered.unattributed).toBe(true);
    expect(filtered.total).toBe(216);

    const unfiltered = buildPeriod(mixed, {
      grain: "daily",
      metric: "count",
      today: TODAY,
    });
    expect(unfiltered.unattributed).toBe(false);
    expect(unfiltered.total).toBe(770);
  });
});

describe("monthly", () => {
  const hist: History = {
    "2026-01-15": day({ ram: [500, 100] }),
    "2026-01-20": day({ ram: [300, 100] }),
    "2026-09-09": day({ ram: [216, 100] }),
    "2025-09-09": day({ ram: [9999, 100] }),
  };

  it("has twelve buckets for the year, and marks the month we are in", () => {
    const p = buildPeriod(hist, { grain: "monthly", metric: "count", today: TODAY });
    expect(p.buckets).toHaveLength(12);
    expect(p.label).toBe("2026");
    expect(p.buckets.find((b) => b.isNow)!.label).toBe("Sep");
  });

  it("sums each month and ignores other years", () => {
    const p = buildPeriod(hist, { grain: "monthly", metric: "count", today: TODAY });
    expect(p.buckets[0].value).toBe(800);
    expect(p.buckets[8].value).toBe(216);
    expect(p.total).toBe(1016);
  });

  it("steps back a year", () => {
    const p = buildPeriod(hist, {
      grain: "monthly",
      metric: "count",
      offset: -1,
      today: TODAY,
    });
    expect(p.label).toBe("2025");
    expect(p.total).toBe(9999);
  });
});

describe("yearly", () => {
  it("shows five years ending with the one in view", () => {
    const hist: History = {
      "2026-09-09": day({ ram: [100, 0] }),
      "2024-01-01": day({ ram: [50, 0] }),
      "2019-01-01": day({ ram: [7, 0] }),
    };
    const p = buildPeriod(hist, { grain: "yearly", metric: "count", today: TODAY });
    expect(p.buckets.map((b) => b.label)).toEqual([
      "2022", "2023", "2024", "2025", "2026",
    ]);
    expect(p.label).toBe("2022 – 2026");
    expect(p.total).toBe(150);
    expect(p.buckets.find((b) => b.isNow)!.label).toBe("2026");
  });
});

describe("empty history", () => {
  it("gives zeroes rather than blowing up", () => {
    for (const grain of ["daily", "monthly", "yearly"] as const) {
      const p = buildPeriod({}, { grain, metric: "count", today: TODAY });
      expect(p.total).toBe(0);
      expect(p.perDay).toBe(0);
      expect(p.activeBuckets).toBe(0);
      expect(p.buckets.length).toBeGreaterThan(0);
    }
  });
});

describe("navigation", () => {
  it("cannot step into the future", () => {
    expect(canGoForward(0)).toBe(false);
    expect(canGoForward(-1)).toBe(true);
  });

  it("B47: stops going back at the first day with chants in it", () => {
    const hist: History = { "2026-08-31": legacyDay(10), "2026-09-09": { c: 0, r: 0, s: 0 } };
    expect(firstRecordedDay(hist)).toBe("2026-08-31");
    // This week starts Monday 7 Sep; the week before holds 31 Aug.
    expect(canGoBack(hist, "daily", 0, TODAY)).toBe(true);
    expect(canGoBack(hist, "daily", -1, TODAY)).toBe(false);
    expect(canGoBack(hist, "monthly", 0, TODAY)).toBe(false);
    expect(canGoBack(hist, "yearly", 0, TODAY)).toBe(false);
  });

  it("B46: an empty record for today is not a start", () => {
    const hist: History = { [TODAY]: { c: 0, r: 0, s: 0 } };
    expect(firstRecordedDay(hist)).toBeNull();
    expect(canGoBack(hist, "daily", 0, TODAY)).toBe(false);
  });
});

describe("formatting", () => {
  it("reads durations as people say them", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
    expect(formatDuration(90 * 60_000)).toBe("1.5h");
    expect(formatDuration(20 * 3_600_000)).toBe("20h");
  });

  it("groups counts the Indian way", () => {
    expect(formatValue(100_000, "count")).toBe("1,00,000");
    expect(formatValue(3_600_000, "time")).toBe("1.0h");
  });
});
