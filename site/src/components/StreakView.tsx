"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fromDayKey } from "@/lib/counter/day";
import {
  WEEKDAYS,
  dateNumerals,
  fmtDigits,
  fmtNum,
  langOf,
  monthTitle,
  numeralsOf,
  tr,
  type Numerals,
  type UiLang,
} from "@/lib/counter/page-lang";
import type { DayRec } from "@/lib/counter/storage";
import {
  calendarMonth,
  summarise,
  weekStrip,
  type CalendarCell,
  type History,
} from "@/lib/counter/streak";
import { firstRecordedDay } from "@/lib/counter/stats";
import { useCounterState } from "@/lib/counter/useCounterState";
import { useToday } from "@/lib/counter/useToday";

/** Reads the practice the counter has already saved. Writes nothing. */
export default function StreakView() {
  const state = useCounterState();
  const hist = (state?.hist ?? {}) as History;
  /* The two settings the counter saves: this page speaks the same language as
     the ring the counts came from (#16/#29). */
  const lang = langOf(state);
  const numerals = numeralsOf(state);
  /*
   * Tell the browser which language it is reading, or a screen reader says the
   * Hindi with an English voice — the same fault as #37 in the home heading. The
   * counter's engine does this for its own page; these pages are separate.
   */
  useEffect(() => {
    if (lang !== "hi") return;
    const root = document.documentElement;
    const before = root.lang;
    root.lang = "hi";
    return () => {
      root.lang = before;
    };
  }, [lang]);

  /* Null in the prerendered HTML and on the first client render; see useToday. */
  const today = useToday();

  /** Which month the calendar is showing, as an offset from this one. */
  const [monthOffset, setMonthOffset] = useState(0);
  /** The calendar day whose count is read out (B48: a title tooltip reached no finger or key). */
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  if (!today) return <StreakPlaceholder lang={lang} />;

  const now = fromDayKey(today) ?? new Date();
  const shown = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const cal = calendarMonth(hist, shown.getFullYear(), shown.getMonth() + 1, today);
  const calTitle = monthTitle(cal.year, cal.month, lang, numerals);

  const s = summarise(hist, today);
  const week = weekStrip(hist, today);

  /* B46: a start needs chants in it. Opening the counter writes an empty record
     for today, which hid the empty-state message. */
  const firstDay = firstRecordedDay(hist);
  const started = firstDay !== null;
  const shownMonth = `${shown.getFullYear()}-${String(shown.getMonth() + 1).padStart(2, "0")}`;
  const dn = dateNumerals(lang, numerals);
  const picked = pickedDay && pickedDay.startsWith(shownMonth) ? pickedDay : null;

  return (
    <div className="streak">
      <h1>{tr(lang, "streak")}</h1>

      {!started && <p className="lead">{tr(lang, "streakEmpty")}</p>}

      <div className="cards">
        <div className="card now">
          <span className="k">{tr(lang, "current")}</span>
          <b>{fmtNum(s.current, numerals)}</b>
          <span className="u">{tr(lang, s.current === 1 ? "day" : "days")}</span>
        </div>
        <div className="card">
          <span className="k">{tr(lang, "best")}</span>
          <b>{fmtNum(s.best, numerals)}</b>
          <span className="u">{tr(lang, s.best === 1 ? "day" : "days")}</span>
        </div>
        <div className="card">
          <span className="k">{tr(lang, "daysPractised")}</span>
          <b>{fmtNum(s.totalDays, numerals)}</b>
          <span className="u">{tr(lang, "inAll")}</span>
        </div>
      </div>

      {s.atRisk && (
        <p className="at-risk">
          {tr(lang, "atRisk")} <Link href="/">{tr(lang, "openCounter")}</Link>
        </p>
      )}

      <section className="panel">
        <h2>{tr(lang, "thisWeek")}</h2>
        <ol className="week">
          {week.map((d, i) => (
            <li key={d.key} data-state={d.state} data-today={d.isToday || undefined}>
              <span className="wd">{WEEKDAYS[lang][i]}</span>
              <span className="dot" title={`${fmtDigits(d.key, dn)}: ${label(d.state, lang)}`}>
                <span className="sr-only">{label(d.state, lang)}</span>
                <span aria-hidden="true">{glyph(d.state)}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel">
        <header className="cal-head">
          <button
            type="button"
            onClick={() => setMonthOffset((n) => n - 1)}
            disabled={!firstDay || shownMonth <= firstDay.slice(0, 7)}
            aria-label={tr(lang, "prevMonth")}
          >
            ‹
          </button>
          <h2>{calTitle}</h2>
          <button
            type="button"
            onClick={() => setMonthOffset((n) => n + 1)}
            disabled={monthOffset >= 0}
            aria-label={tr(lang, "nextMonth")}
          >
            ›
          </button>
        </header>

        <div className="cal" role="grid" aria-label={calTitle}>
          <div className="cal-row" role="row">
            {WEEKDAYS[lang].map((w) => (
              <span key={w} className="cal-wd" role="columnheader">
                {w}
              </span>
            ))}
          </div>
          {weeksOf(cal.leading, cal.cells).map((week, w) => (
            <div className="cal-row" role="row" key={`week-${w}`}>
              {week.map((c, i) =>
                c === null ? (
                  <span key={`pad-${w}-${i}`} className="cal-pad" role="gridcell" />
                ) : (
                  <span
                    key={c.key}
                    className="cal-day"
                    role="gridcell"
                    tabIndex={c.state === "future" ? undefined : 0}
                    aria-selected={picked === c.key}
                    data-state={c.state}
                    data-today={c.isToday || undefined}
                    title={`${fmtDigits(c.key, dn)}: ${label(c.state, lang)}${count(hist[c.key], numerals)}`}
                    onClick={() => c.state !== "future" && setPickedDay(c.key)}
                    onFocus={() => c.state !== "future" && setPickedDay(c.key)}
                  >
                    {fmtNum(c.dayOfMonth, dn)}
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
        <p className="readout" aria-live="polite">
          {picked
            ? `${fmtNum(Number(picked.slice(8)), dn)} ${calTitle}: ${label(cellState(cal.cells, picked), lang)}${count(hist[picked], numerals)}`
            : tr(lang, "tapDay")}
        </p>
      </section>
    </div>
  );
}

function cellState(cells: CalendarCell[], key: string): string {
  return cells.find((c) => c.key === key)?.state ?? "missed";
}

/**
 * What the prerendered HTML and the first client render show: the page's frame
 * with no day in it. Nothing here depends on the date, so it cannot disagree with
 * the browser the way the build day did.
 */
function StreakPlaceholder({ lang }: { lang: UiLang }) {
  return (
    <div className="streak" aria-busy="true">
      <h1>{tr(lang, "streak")}</h1>
      <div className="cards">
        {(["current", "best", "daysPractised"] as const).map((k, i) => (
          <div key={k} className={i === 0 ? "card now" : "card"}>
            <span className="k">{tr(lang, k)}</span>
            <b>–</b>
            <span className="u">&nbsp;</span>
          </div>
        ))}
      </div>
      <section className="panel">
        <h2>{tr(lang, "thisWeek")}</h2>
        <ol className="week">
          {WEEKDAYS[lang].map((w) => (
            <li key={w}>
              <span className="wd">{w}</span>
              <span className="dot" />
            </li>
          ))}
        </ol>
      </section>
      {/* B19: the calendar's frame too, so it does not push the page down once
          the date is known (CLS 0.43 on a phone). */}
      <section className="panel" aria-hidden="true">
        <header className="cal-head">
          <button type="button" disabled tabIndex={-1}>
            ‹
          </button>
          <h2>&nbsp;</h2>
          <button type="button" disabled tabIndex={-1}>
            ›
          </button>
        </header>
        <div className="cal">
          {WEEKDAYS[lang].map((w) => (
            <span key={w} className="cal-wd">
              {w}
            </span>
          ))}
          {Array.from({ length: 35 }, (_, i) => (
            <span key={i} className="cal-pad" />
          ))}
        </div>
        <p className="readout">&nbsp;</p>
      </section>
    </div>
  );
}

/**
 * The month as rows of seven, blanks first. An ARIA grid must hold rows, and
 * rows must hold the cells; a flat list of gridcells is a critical violation
 * even though the CSS grid draws it correctly. The rows are display:contents,
 * so the drawing does not change.
 */
function weeksOf(leading: number, cells: CalendarCell[]): (CalendarCell | null)[][] {
  const slots: (CalendarCell | null)[] = [...Array.from({ length: leading }, () => null), ...cells];
  while (slots.length % 7 !== 0) slots.push(null);
  const weeks: (CalendarCell | null)[][] = [];
  for (let i = 0; i < slots.length; i += 7) weeks.push(slots.slice(i, i + 7));
  return weeks;
}

function label(state: string, lang: UiLang): string {
  if (state === "done") return tr(lang, "donePractised");
  if (state === "future") return tr(lang, "stillToCome");
  if (state === "open") return tr(lang, "todayOpen");
  if (state === "before") return tr(lang, "beforeStart");
  return tr(lang, "noMala");
}

/* Only a real miss is a cross. Today is a ring until its mala is done, and days
   before the practice began are as plain as the days still to come. */
function glyph(state: string): string {
  if (state === "done") return "✓";
  if (state === "open") return "○";
  if (state === "missed") return "✕";
  return "·";
}

function count(rec: DayRec | undefined, numerals: Numerals): string {
  return rec?.c ? ` — ${fmtNum(rec.c, numerals)}` : "";
}
