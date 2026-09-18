/**
 * Ramadan and the other seasons, as dates a human sets.
 * Specification sections 21, 57, 61.
 *
 * WHY THE DATES ARE TYPED IN RATHER THAN COMPUTED
 * A tabular Hijri calendar can be computed to the day. When Ramadan actually
 * begins cannot: it depends on the sighting of the moon, it differs between
 * countries, and it differs between communities within one country. A product
 * that announced "Ramadan starts today" from an algorithm would be making a
 * religious determination, which section 21 says this product does not do.
 *
 * So the dates below are entered by a person each year, they are described as
 * approximate, and the UI says so. The cost is one edit a year. The alternative
 * is telling somebody they are fasting on the wrong day.
 *
 * Nothing here changes what a count means. A season adds suggestions and a
 * progress view over days the user has already chosen to count.
 */

import { addDays, daysBetween } from "@/core/dates";

export interface Season {
  id: "ramadan" | "last-ten" | "dhul-hijjah";
  name: string;
  /** Inclusive, device local dates, YYYY-MM-DD. */
  from: string;
  to: string;
  /** Shown at the top of the season view. Never a claim about reward. */
  blurb: string;
  /** Suggested daily portions. Every one of these is a user goal, not a ruling. */
  suggestions: { dhikrId: string; perDay: number; note: string }[];
}

/**
 * Approximate Gregorian windows, to be corrected each year by a person once the
 * month is announced locally. Marked clearly as approximate wherever shown.
 */
export const SEASONS: Season[] = [
  {
    id: "ramadan",
    name: "Ramadan",
    from: "2027-02-08",
    to: "2027-03-09",
    blurb:
      "A month many people set themselves a larger daily portion. The dates here are approximate — your local announcement is what decides, not this page.",
    suggestions: [
      {
        dhikrId: "astaghfirullah",
        perDay: 100,
        note: "A daily portion of istighfar many people keep all year, and raise in Ramadan.",
      },
      {
        dhikrId: "salawat",
        perDay: 100,
        note: "Salawat upon the Prophet ﷺ.",
      },
      {
        dhikrId: "subhanallahi-wa-bihamdihi",
        perDay: 100,
        note: "A short phrase with a cited daily count.",
      },
    ],
  },
  {
    id: "last-ten",
    name: "The last ten nights",
    from: "2027-02-27",
    to: "2027-03-09",
    blurb:
      "The final ten nights of Ramadan. Approximate dates; follow your local announcement.",
    suggestions: [
      {
        dhikrId: "afuwwun",
        perDay: 100,
        note: "The supplication taught for these nights.",
      },
    ],
  },
  {
    id: "dhul-hijjah",
    name: "The first ten days of Dhul Hijjah",
    from: "2027-05-07",
    to: "2027-05-16",
    blurb:
      "Ten days many people increase takbir, tahmid and tahlil. Approximate dates.",
    suggestions: [
      { dhikrId: "allahu-akbar", perDay: 100, note: "Takbir." },
      { dhikrId: "alhamdulillah", perDay: 100, note: "Tahmid." },
      { dhikrId: "la-ilaha-illallah", perDay: 100, note: "Tahlil." },
    ],
  },
];

/** The season covering a given local date, if any. Most specific first. */
export function seasonFor(localDate: string): Season | null {
  // "last-ten" sits inside "ramadan", so the narrower window wins.
  const matches = SEASONS.filter((s) => localDate >= s.from && localDate <= s.to);
  if (matches.length === 0) return null;
  return (
    matches.find((s) => s.id === "last-ten") ??
    matches.find((s) => s.id === "dhul-hijjah") ??
    matches[0] ??
    null
  );
}

/** Days elapsed and remaining, for the progress line. */
export function seasonProgress(
  season: Season,
  localDate: string,
): { day: number; total: number } {
  // `daysBetween` from core/dates, for the same reason as above: this file is
  // not allowed to do its own calendar arithmetic (section 12.3).
  const total = daysBetween(season.from, season.to) + 1;
  const elapsed = daysBetween(season.from, localDate) + 1;
  return { day: Math.min(total, Math.max(1, elapsed)), total };
}

/**
 * How far ahead a season is announced on the home page. Three weeks is enough
 * to be useful and short enough not to be noise for eleven months of the year.
 */
export const SEASON_LOOKAHEAD_DAYS = 21;

export function upcomingSeason(localDate: string): Season | null {
  // `addDays` from core/dates, NOT hand-rolled arithmetic.
  //
  // This was `new Date(...)` then `.toISOString().slice(0, 10)`, which parses
  // as LOCAL time and formats as UTC. Anywhere east of Greenwich, local
  // midnight is the previous day in UTC, so the horizon came out a day short
  // and a season could be announced a day late.
  //
  // Section 12.3 exists for exactly this: core/dates.ts is the only module
  // allowed to derive a calendar day, and this file had quietly become a
  // second one.
  const horizon = addDays(localDate, SEASON_LOOKAHEAD_DAYS);

  return (
    SEASONS.filter((s) => s.from > localDate && s.from <= horizon).sort((a, b) =>
      a.from < b.from ? -1 : 1,
    )[0] ?? null
  );
}
