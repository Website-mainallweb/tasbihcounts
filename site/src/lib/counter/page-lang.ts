import type { Metric } from "./stats";
import { formatDuration } from "./stats";

/**
 * Hindi for the pages outside the counter (UX walkthrough #16/#29).
 *
 * The counter has had both languages since Phase 1, but Streak and Stats stayed
 * in English, so choosing Hindi changed the ring and left the two pages that
 * read the same practice speaking another language. They now follow the same
 * two settings the counter saves: `lang` and `numerals`.
 *
 * Deliberately small: one flat dictionary, no i18n library, and English is the
 * fallback for anything a future key forgets.
 */

export type UiLang = "en" | "hi";
export type Numerals = "latin" | "deva";

const EN = {
  streak: "Streak",
  streakEmpty: "Nothing recorded yet. Complete a mala and the first day appears here.",
  current: "Current",
  best: "Best",
  /* B69: the number is days the target was reached, not every day with a count. */
  daysPractised: "Days target reached",
  day: "day",
  days: "days",
  inAll: "in all",
  atRisk: "Today is still open. Finish a mala to carry the streak forward.",
  openCounter: "Open the counter",
  thisWeek: "This week",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  donePractised: "Practised",
  stillToCome: "Still to come",
  todayOpen: "Today — still open",
  beforeStart: "Before your practice began",
  noMala: "No mala completed",

  statsTitle: "Nam Jap Stats",
  timeTitle: "Time on the mala",
  measure: "What to measure",
  metricCount: "Naam",
  metricTime: "Timer",
  grain: "Grain",
  daily: "Daily",
  monthly: "Monthly",
  yearly: "Yearly",
  statsEmpty: "Nothing recorded yet. Your counts appear here as you chant.",
  earlier: "Earlier",
  later: "Later",
  filterByName: "Filter by name",
  allNames: "All names",
  beforeNames: "Before names were tracked",
  total: "Total",
  perDay: "Average a day",
  unattributed:
    "Some days in this range were recorded before counts were kept per name, so they are not included in this filter. “All names” shows everything.",
  nothingHere: "Nothing recorded in this period.",
  tapDay: "Tap a day to see its count.",
  minutes: "m",
  hours: "h",
};

const HI: Record<keyof typeof EN, string> = {
  streak: "निरंतरता",
  streakEmpty: "अभी कुछ दर्ज नहीं। एक माला पूरी करें और पहला दिन यहाँ दिखेगा।",
  current: "अभी",
  best: "सर्वश्रेष्ठ",
  daysPractised: "लक्ष्य पूरे हुए दिन",
  day: "दिन",
  days: "दिन",
  inAll: "कुल",
  atRisk: "आज अभी बाकी है। एक माला पूरी करें और निरंतरता आगे बढ़ेगी।",
  openCounter: "काउंटर खोलें",
  thisWeek: "इस सप्ताह",
  prevMonth: "पिछला महीना",
  nextMonth: "अगला महीना",
  donePractised: "माला पूर्ण",
  stillToCome: "आना बाकी",
  todayOpen: "आज — अभी बाकी",
  beforeStart: "साधना शुरू होने से पहले",
  noMala: "माला पूरी नहीं",

  statsTitle: "जप के आँकड़े",
  timeTitle: "माला का समय",
  measure: "क्या मापें",
  metricCount: "नाम",
  metricTime: "समय",
  grain: "अवधि",
  daily: "दैनिक",
  monthly: "मासिक",
  yearly: "वार्षिक",
  statsEmpty: "अभी कुछ दर्ज नहीं। जप करते जाओ, गिनती यहाँ दिखेगी।",
  earlier: "पहले",
  later: "बाद",
  filterByName: "नाम से छाँटें",
  allNames: "सभी नाम",
  beforeNames: "नाम दर्ज होने से पहले",
  total: "कुल",
  perDay: "रोज़ का औसत",
  unattributed:
    "इस अवधि के कुछ दिन तब दर्ज हुए जब गिनती नाम के हिसाब से नहीं रखी जाती थी, इसलिए वे इस छाँट में नहीं हैं। “सभी नाम” में सब दिखता है।",
  nothingHere: "इस अवधि में कुछ दर्ज नहीं।",
  tapDay: "किसी दिन को छूकर उसकी गिनती देखें।",
  minutes: " मि",
  hours: " घं",
};

const STRINGS: Record<UiLang, Record<keyof typeof EN, string>> = { en: EN, hi: HI };

export const MONTHS: Record<UiLang, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  hi: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितम्बर", "अक्तूबर", "नवम्बर", "दिसम्बर"],
};

/** Monday first, as the week strip and the calendar are drawn. */
export const WEEKDAYS: Record<UiLang, string[]> = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  hi: ["सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"],
};

export const MONTHS_SHORT: Record<UiLang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  hi: ["जन", "फ़र", "मार्च", "अप्रैल", "मई", "जून", "जुल", "अग", "सित", "अक्तू", "नव", "दिस"],
};

const DEV_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

/** What the counter saved, or English when nothing is saved yet. */
export function langOf(state: Record<string, unknown> | null | undefined): UiLang {
  return state && state.lang === "hi" ? "hi" : "en";
}

export function numeralsOf(state: Record<string, unknown> | null | undefined): Numerals {
  return state && state.numerals === "deva" ? "deva" : "latin";
}

export function tr(lang: UiLang, key: keyof typeof EN): string {
  return STRINGS[lang][key] || EN[key];
}

/** Indian grouping, and Devanagari digits when the counter is set to them. */
export function fmtNum(value: number, numerals: Numerals = "latin"): string {
  const text = value.toLocaleString("en-IN");
  return numerals === "deva" ? text.replace(/[0-9]/g, (d) => DEV_DIGITS[Number(d)]) : text;
}

export function fmtDigits(text: string, numerals: Numerals = "latin"): string {
  return numerals === "deva" ? text.replace(/[0-9]/g, (d) => DEV_DIGITS[Number(d)]) : text;
}

/** A chant count or a stretch of time, in the reader's language and digits. */
export function fmtMeasure(value: number, metric: Metric, lang: UiLang, numerals: Numerals): string {
  if (metric !== "time") return fmtNum(value, numerals);
  const english = formatDuration(value);
  const withUnits = english
    .replace(/m$/, tr(lang, "minutes"))
    .replace(/h$/, tr(lang, "hours"));
  return fmtDigits(withUnits, numerals);
}

/**
 * Digits inside a date follow the language (B49): with English month names they
 * stay 0–9, where "७ Sep – १३ Sep" mixed two scripts in one label. Counts still
 * use the Numerals setting.
 */
export function dateNumerals(lang: UiLang, numerals: Numerals): Numerals {
  return lang === "hi" ? numerals : "latin";
}

/** "September 2026" / "सितम्बर २०२६". */
export function monthTitle(year: number, month: number, lang: UiLang, numerals: Numerals): string {
  return `${MONTHS[lang][month - 1]} ${fmtDigits(String(year), dateNumerals(lang, numerals))}`;
}

/** The label a Stats bar carries, translated where it is a name or a month. */
export function bucketLabel(label: string, lang: UiLang, numerals: Numerals): string {
  const weekday = WEEKDAYS.en.indexOf(label);
  if (weekday > -1) return WEEKDAYS[lang][weekday];
  const month = MONTHS_SHORT.en.indexOf(label);
  if (month > -1) return MONTHS_SHORT[lang][month];
  return fmtDigits(label, dateNumerals(lang, numerals));
}

/** A period label like "7 Sep – 13 Sep" or "2022 – 2026", translated in place. */
export function rangeLabel(label: string, lang: UiLang, numerals: Numerals): string {
  let out = label;
  if (lang !== "en") {
    MONTHS_SHORT.en.forEach((month, i) => {
      out = out.split(month).join(MONTHS_SHORT.hi[i]);
    });
  }
  return fmtDigits(out, dateNumerals(lang, numerals));
}
