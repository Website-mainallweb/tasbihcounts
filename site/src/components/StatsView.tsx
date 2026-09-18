"use client";

import { useEffect, useMemo, useState } from "react";

import { dayKey } from "@/lib/counter/day";
import {
  type Grain,
  type Metric,
  type NameFilter,
  buildPeriod,
  canGoBack,
  canGoForward,
  firstRecordedDay,
  hasNameBreakdown,
  namesInHistory,
} from "@/lib/counter/stats";
import type { History } from "@/lib/counter/stats";
import { nameLabel } from "@/lib/counter/names";
import {
  bucketLabel,
  fmtMeasure,
  langOf,
  numeralsOf,
  rangeLabel,
  tr,
  type UiLang,
} from "@/lib/counter/page-lang";
import { useCounterState } from "@/lib/counter/useCounterState";
import { useToday } from "@/lib/counter/useToday";

const GRAINS: { id: Grain; key: "daily" | "monthly" | "yearly" }[] = [
  { id: "daily", key: "daily" },
  { id: "monthly", key: "monthly" },
  { id: "yearly", key: "yearly" },
];

/**
 * Reads the practice the counter saved and adds it up. Writes nothing.
 *
 * The chart is drawn rather than imported. A bar chart is a row of rectangles
 * with known heights, and this page is a route of its own, so pulling in a
 * charting library would add weight to the bundle for something a div can do.
 */
export default function StatsView() {
  const state = useCounterState();
  /* Memoised because the fallback creates a new empty object on every render,
     and every derived value below depends on this one. */
  const hist = useMemo(() => (state?.hist ?? {}) as History, [state]);

  const [metric, setMetric] = useState<Metric>("count");
  const [grain, setGrain] = useState<Grain>("daily");
  const [offset, setOffset] = useState(0);
  const [name, setName] = useState<NameFilter>(null);
  const [picked, setPicked] = useState<string | null>(null);

  /* Null in the prerendered HTML and on the first client render. A dayKey() here
     baked the build day into the page, and the "today" bar stayed on it. */
  const today = useToday();
  const names = useMemo(() => namesInHistory(hist), [hist]);
  const custom = state?.custom;
  const canFilter = hasNameBreakdown(hist);

  /* The counter's own two settings, so the numbers here read the way they do on
     the ring that produced them (#16/#29). */
  const lang = langOf(state);
  const numerals = numeralsOf(state);
  const show = (value: number) => fmtMeasure(value, metric, lang, numerals);

  /* Which language the page is in, for a screen reader — see StreakView. */
  useEffect(() => {
    if (lang !== "hi") return;
    const root = document.documentElement;
    const before = root.lang;
    root.lang = "hi";
    return () => {
      root.lang = before;
    };
  }, [lang]);

  const period = useMemo(
    () => buildPeriod(hist, { grain, metric, name, offset, today: today ?? dayKey(new Date(0)) }),
    [hist, grain, metric, name, offset, today],
  );

  if (!today) return <StatsPlaceholder lang={lang} />;

  const max = Math.max(...period.buckets.map((b) => b.value), 1);
  const selected =
    period.buckets.find((b) => b.key === picked) ??
    period.buckets.find((b) => b.isNow) ??
    null;

  /* B46: only a day with chants in it; the counter writes an empty one for today on open. */
  const started = firstRecordedDay(hist) !== null;

  /** Changing what is measured resets where you are looking. */
  const setGrainAndReset = (g: Grain) => {
    setGrain(g);
    setOffset(0);
    setPicked(null);
  };

  return (
    <div className="stats">
      <div className="head">
        <h1>{tr(lang, metric === "count" ? "statsTitle" : "timeTitle")}</h1>
        <div className="seg metric" role="group" aria-label={tr(lang, "measure")}>
          {(["count", "time"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => {
                setMetric(m);
                setPicked(null);
              }}
            >
              {tr(lang, m === "count" ? "metricCount" : "metricTime")}
            </button>
          ))}
        </div>
      </div>

      {!started && <p className="lead">{tr(lang, "statsEmpty")}</p>}

      <div className="seg grain" role="group" aria-label={tr(lang, "grain")}>
        {GRAINS.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={grain === g.id}
            onClick={() => setGrainAndReset(g.id)}
          >
            {tr(lang, g.key)}
          </button>
        ))}
      </div>

      <div className="bar-head">
        <div className="nav">
          <button
            type="button"
            onClick={() => {
              setOffset((n) => n - 1);
              setPicked(null);
            }}
            disabled={!canGoBack(hist, grain, offset, today)}
            aria-label={tr(lang, "earlier")}
          >
            ‹
          </button>
          <span className="range">{rangeLabel(period.label, lang, numerals)}</span>
          <button
            type="button"
            onClick={() => {
              setOffset((n) => n + 1);
              setPicked(null);
            }}
            disabled={!canGoForward(offset)}
            aria-label={tr(lang, "later")}
          >
            ›
          </button>
        </div>

        {canFilter && (
          <label className="filter">
            <span className="sr-only">{tr(lang, "filterByName")}</span>
            <select
              value={name ?? ""}
              onChange={(e) => setName(e.target.value || null)}
            >
              <option value="">{tr(lang, "allNames")}</option>
              {names.map((n) => (
                <option key={n.id} value={n.id}>
                  {/* A synced day from before names were tracked arrives as one lump. */}
                  {n.id === "_day" ? tr(lang, "beforeNames") : nameLabel(n.id, custom, lang)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="totals">
        <div className="t">
          <span className="k">{tr(lang, "total")}</span>
          <b>{show(period.total)}</b>
        </div>
        <div className="t">
          <span className="k">{tr(lang, "perDay")}</span>
          <b>{show(period.perDay)}</b>
        </div>
      </div>

      {period.unattributed && <p className="note">{tr(lang, "unattributed")}</p>}

      <div className="chart">
        <ol className="bars">
          {period.buckets.map((b) => {
            const pct = Math.round((b.value / max) * 100);
            const lb = bucketLabel(b.label, lang, numerals);
            return (
              <li key={b.key} data-now={b.isNow || undefined}>
                <button
                  type="button"
                  className="bar"
                  aria-pressed={selected?.key === b.key}
                  onClick={() => setPicked(b.key)}
                  title={`${lb}: ${show(b.value)}`}
                >
                  <span className="sr-only">
                    {lb}: {show(b.value)}
                  </span>
                  <span
                    className="fill"
                    data-empty={b.value === 0 || undefined}
                    style={b.value > 0 ? { height: `${Math.max(pct, 3)}%` } : undefined}
                    aria-hidden="true"
                  />
                </button>
                <span className="lb">{lb}</span>
              </li>
            );
          })}
        </ol>

        <p className="readout" aria-live="polite">
          {selected && selected.value > 0
            ? `${bucketLabel(selected.label, lang, numerals)}: ${show(selected.value)}`
            : tr(lang, "nothingHere")}
        </p>
      </div>
    </div>
  );
}

/** The frame the prerendered HTML carries: no day in it to disagree with the browser. */
function StatsPlaceholder({ lang }: { lang: UiLang }) {
  return (
    <div className="stats" aria-busy="true">
      {/* B20: the finished page's frame (tabs, range, totals), so nothing below
          it moves when the numbers arrive. */}
      <div className="head">
        <h1>{tr(lang, "statsTitle")}</h1>
        <div className="seg metric" aria-hidden="true">
          {(["metricCount", "metricTime"] as const).map((k) => (
            <button key={k} type="button" disabled tabIndex={-1}>
              {tr(lang, k)}
            </button>
          ))}
        </div>
      </div>
      <div className="seg grain" aria-hidden="true">
        {GRAINS.map((g) => (
          <button key={g.id} type="button" disabled tabIndex={-1}>
            {tr(lang, g.key)}
          </button>
        ))}
      </div>
      <div className="bar-head" aria-hidden="true">
        <div className="nav">
          <button type="button" disabled tabIndex={-1}>
            ‹
          </button>
          <span className="range">&nbsp;</span>
          <button type="button" disabled tabIndex={-1}>
            ›
          </button>
        </div>
      </div>
      <div className="totals" aria-hidden="true">
        {(["total", "perDay"] as const).map((k) => (
          <div className="t" key={k}>
            <span className="k">{tr(lang, k)}</span>
            <b>–</b>
          </div>
        ))}
      </div>
      <div className="chart">
        <ol className="bars">
          {Array.from({ length: 7 }, (_, i) => (
            <li key={i}>
              <span className="bar" aria-hidden="true">
                <span className="fill" data-empty="" />
              </span>
              <span className="lb">&nbsp;</span>
            </li>
          ))}
        </ol>
        <p className="readout">&nbsp;</p>
      </div>
    </div>
  );
}
