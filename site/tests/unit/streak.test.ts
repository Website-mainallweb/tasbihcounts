import { describe, expect, it } from "vitest";

import { addDays, dayKey, daysBetween, fromDayKey, shiftKey } from "../../src/lib/counter/day";
import {
  type History,
  bestStreak,
  calendarMonth,
  currentStreak,
  qualifies,
  summarise,
  weekStrip,
} from "../../src/lib/counter/streak";

/** A day that counted, and one that did not. */
const done = { c: 108, r: 1, s: 300_000 };
const tapped = { c: 40, r: 0, s: 90_000 };

/** History from a list of day keys that all qualify. */
const hist = (...days: string[]): History =>
  Object.fromEntries(days.map((d) => [d, done]));

describe("dayKey", () => {
  it("formats the device's own calendar date", () => {
    expect(dayKey(new Date(2026, 8, 9))).toBe("2026-09-09");
    expect(dayKey(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("does not slip to UTC", () => {
    // 00:30 local on the 9th is still the 9th, whatever UTC calls it. Using
    // toISOString here would move early-morning japa into the previous day.
    expect(dayKey(new Date(2026, 8, 9, 0, 30))).toBe("2026-09-09");
    expect(dayKey(new Date(2026, 8, 9, 23, 45))).toBe("2026-09-09");
  });

  it("round-trips", () => {
    expect(dayKey(fromDayKey("2026-09-09")!)).toBe("2026-09-09");
  });

  it("refuses a date that does not exist", () => {
    expect(fromDayKey("2026-02-30")).toBeNull();
    expect(fromDayKey("2023-02-29")).toBeNull();
    expect(fromDayKey("nonsense")).toBeNull();
    expect(fromDayKey("2026-9-9")).toBeNull();
  });
});

describe("stepping by days", () => {
  it("crosses a month and a year", () => {
    expect(shiftKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("knows February", () => {
    expect(shiftKey("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftKey("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("counts by the calendar, not by milliseconds", () => {
    // Adding 86_400_000 across a clock change lands an hour out and can skip or
    // repeat a date. Stepping the calendar parts cannot.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-27")).toBe(3);
    expect(daysBetween("2026-09-09", "2026-09-09")).toBe(0);
    expect(daysBetween("2026-09-10", "2026-09-09")).toBe(-1);
  });

  it("steps a whole year without drifting", () => {
    let k = "2026-01-01";
    for (let i = 0; i < 365; i++) k = shiftKey(k, 1)!;
    expect(k).toBe("2027-01-01");
  });

  it("addDays keeps local midnight", () => {
    const d = addDays(new Date(2026, 8, 9), 1);
    expect(d.getHours()).toBe(0);
    expect(dayKey(d)).toBe("2026-09-10");
  });
});

describe("what counts as a day", () => {
  it("needs a completed round, not merely a tap", () => {
    expect(qualifies(done)).toBe(true);
    expect(qualifies(tapped)).toBe(false);
    expect(qualifies(undefined)).toBe(false);
    expect(qualifies({ c: 0, r: 0, s: 0 })).toBe(false);
  });
});

describe("currentStreak", () => {
  const today = "2026-09-09";

  it("is zero with no history", () => {
    expect(currentStreak({}, today)).toBe(0);
  });

  it("counts back from today", () => {
    expect(currentStreak(hist("2026-09-07", "2026-09-08", today), today)).toBe(3);
  });

  it("survives a day that is not over yet", () => {
    // Nobody's streak should break at midnight while there is still time to
    // practise. The run rides on yesterday until today is spent.
    expect(currentStreak(hist("2026-09-07", "2026-09-08"), today)).toBe(2);
  });

  it("has lapsed once the gap is more than a day", () => {
    expect(currentStreak(hist("2026-09-06", "2026-09-07"), today)).toBe(0);
  });

  it("stops at the first missing day", () => {
    expect(currentStreak(hist("2026-09-01", "2026-09-08", today), today)).toBe(2);
  });

  it("ignores days that were tapped but not completed", () => {
    const h: History = { ...hist("2026-09-08", today), "2026-09-07": tapped };
    expect(currentStreak(h, today)).toBe(2);
  });

  it("counts across a month boundary", () => {
    expect(
      currentStreak(hist("2026-08-30", "2026-08-31", "2026-09-01"), "2026-09-01"),
    ).toBe(3);
  });
});

describe("bestStreak", () => {
  it("is zero with nothing to measure", () => {
    expect(bestStreak({})).toBe(0);
    expect(bestStreak({ "2026-09-09": tapped })).toBe(0);
  });

  it("finds the longest run, not the latest", () => {
    const h = hist(
      "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
      "2026-05-10", "2026-05-11",
    );
    expect(bestStreak(h)).toBe(4);
  });

  it("includes a run still in progress", () => {
    expect(bestStreak(hist("2026-09-07", "2026-09-08", "2026-09-09"))).toBe(3);
  });

  it("is one for a single day", () => {
    expect(bestStreak(hist("2026-09-09"))).toBe(1);
  });

  it("is never smaller than the current run", () => {
    const h = hist("2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09");
    const s = summarise(h, "2026-09-09");
    expect(s.best).toBeGreaterThanOrEqual(s.current);
  });
});

describe("weekStrip", () => {
  it("runs Monday to Sunday and holds seven days", () => {
    // 2026-09-09 is a Wednesday.
    const week = weekStrip({}, "2026-09-09");
    expect(week).toHaveLength(7);
    expect(week[0].key).toBe("2026-09-07");
    expect(week[6].key).toBe("2026-09-13");
  });

  it("marks done, missed and not-yet", () => {
    const week = weekStrip(hist("2026-09-07", "2026-09-09"), "2026-09-09");
    expect(week.map((d) => d.state)).toEqual([
      "done", "missed", "done", "future", "future", "future", "future",
    ]);
  });

  /* UX walkthrough #05: a new user's first week was a row of ✕. */
  it("does not call days before the practice began missed, nor today while it is open", () => {
    const started = { "2026-09-09": { c: 20, r: 0, s: 0 } };
    expect(weekStrip(started, "2026-09-09").map((d) => d.state)).toEqual([
      "before", "before", "open", "future", "future", "future", "future",
    ]);
    expect(weekStrip({}, "2026-09-09").slice(0, 3).map((d) => d.state)).toEqual(["before", "before", "open"]);
  });

  it("knows which one is today", () => {
    const week = weekStrip({}, "2026-09-09");
    expect(week.filter((d) => d.isToday).map((d) => d.key)).toEqual(["2026-09-09"]);
  });

  it("handles a week that straddles two months", () => {
    // 2026-09-01 is a Tuesday, so its week starts in August.
    const week = weekStrip({}, "2026-09-01");
    expect(week[0].key).toBe("2026-08-31");
    expect(week[6].key).toBe("2026-09-06");
  });

  it("puts Monday first even when today is Sunday", () => {
    const week = weekStrip({}, "2026-09-13");
    expect(week[0].key).toBe("2026-09-07");
    expect(week[6].isToday).toBe(true);
  });
});

describe("calendarMonth", () => {
  it("has one cell per day", () => {
    expect(calendarMonth({}, 2026, 9, "2026-09-09").cells).toHaveLength(30);
    expect(calendarMonth({}, 2026, 2, "2026-09-09").cells).toHaveLength(28);
    expect(calendarMonth({}, 2024, 2, "2026-09-09").cells).toHaveLength(29);
  });

  it("pads so the first day lands under its weekday", () => {
    // 1 September 2026 is a Tuesday, one column after Monday.
    expect(calendarMonth({}, 2026, 9, "2026-09-09").leading).toBe(1);
    // 1 February 2026 is a Sunday, the last column.
    expect(calendarMonth({}, 2026, 2, "2026-09-09").leading).toBe(6);
  });

  it("marks the days that counted", () => {
    const cal = calendarMonth(hist("2026-09-03"), 2026, 9, "2026-09-09");
    expect(cal.cells.find((c) => c.dayOfMonth === 3)!.state).toBe("done");
    expect(cal.cells.find((c) => c.dayOfMonth === 4)!.state).toBe("missed");
    expect(cal.cells.find((c) => c.dayOfMonth === 20)!.state).toBe("future");
  });

  it("names itself", () => {
    expect(calendarMonth({}, 2026, 9, "2026-09-09").label).toBe("September 2026");
  });

  it("shows a past month with no future days in it", () => {
    const cal = calendarMonth({}, 2026, 8, "2026-09-09");
    expect(cal.cells.some((c) => c.state === "future")).toBe(false);
  });
});

describe("summarise", () => {
  it("reports the run, the record and how many days ever counted", () => {
    const h = hist("2026-01-01", "2026-09-08", "2026-09-09");
    expect(summarise(h, "2026-09-09")).toEqual({
      current: 2,
      best: 2,
      totalDays: 3,
      atRisk: false,
    });
  });

  it("flags a run riding on yesterday", () => {
    const s = summarise(hist("2026-09-07", "2026-09-08"), "2026-09-09");
    expect(s.current).toBe(2);
    expect(s.atRisk).toBe(true);
  });

  it("does not flag a run with nothing to lose", () => {
    expect(summarise({}, "2026-09-09").atRisk).toBe(false);
  });
});
