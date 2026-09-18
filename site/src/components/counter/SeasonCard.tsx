"use client";

/**
 * The season card (gap 9).
 *
 * Ramadan is when this product's search traffic and its use both peak, and
 * there was nothing seasonal anywhere in it. This is the smallest honest
 * version: while a season is running, offer its portions as one-tap targets and
 * show how far through it you are.
 *
 * WHAT IT DELIBERATELY IS NOT
 *   - it does not announce that Ramadan has begun. The dates are approximate,
 *     it says so, and the local announcement decides (see content/seasons.ts).
 *   - it does not promise anything for a count. Every suggestion is offered as
 *     a goal you may take, and the labelling rule of section 20 still holds.
 *   - it is not a streak with religious weight attached. Missing a day inside
 *     Ramadan produces no message at all, because that is not this product's
 *     business.
 */

import { useEffect, useState } from "react";
import { seasonFor, seasonProgress, upcomingSeason, type Season } from "@/content/seasons";
import { getDhikr } from "@/content/dhikr";
import { toLocalDate } from "@/core/dates";
import { useCounter } from "@/stores/counter-store";
import { useSettings } from "@/stores/settings-store";
import { formatCount } from "@/core/format";

export function SeasonCard() {
  const s = useCounter();
  const settings = useSettings();
  const [today, setToday] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // After mount: the date is device-local and must not be computed on a server
  // that is in another time zone.
  useEffect(() => {
    setToday(toLocalDate());
  }, []);

  if (!today || dismissed) return null;

  const active = seasonFor(today);
  const soon = active ? null : upcomingSeason(today);
  const season: Season | null = active ?? soon;
  if (!season) return null;

  const progress = active ? seasonProgress(active, today) : null;

  return (
    <section className="mt-3 rounded-[var(--radius-md)] border border-accent-line bg-accent-soft p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold text-fg">
            {season.name}
            {progress ? (
              <span className="ms-2 text-[12.5px] font-normal text-accent">
                day {formatCount(progress.day, settings.locale, settings.numerals)} of{" "}
                {formatCount(progress.total, settings.locale, settings.numerals)}
              </span>
            ) : (
              <span className="ms-2 text-[12.5px] font-normal text-accent">soon</span>
            )}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
            {season.blurb}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Hide"
          className="shrink-0 px-1 text-fg-subtle hover:text-fg"
        >
          ×
        </button>
      </div>

      {progress ? (
        <div
          className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface"
          role="img"
          aria-label={`Day ${progress.day} of ${progress.total}`}
        >
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${(progress.day / progress.total) * 100}%` }}
          />
        </div>
      ) : null}

      <ul className="mt-3 space-y-1.5">
        {season.suggestions.map((sug) => {
          const dhikr = getDhikr(sug.dhikrId);
          if (!dhikr) return null;
          return (
            <li key={sug.dhikrId}>
              <button
                type="button"
                onClick={() => {
                  void s.selectDhikr(sug.dhikrId).then(() => {
                    // Offered, and labelled as a goal you took — never as a
                    // recommendation from us (section 20).
                    s.setTarget(sug.perDay, "user-goal");
                  });
                }}
                className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-left transition-colors hover:border-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-fg">
                    {dhikr.name} ×{" "}
                    {formatCount(sug.perDay, settings.locale, settings.numerals)}
                  </span>
                  <span className="block truncate text-[12px] text-fg-muted">
                    {sug.note}
                  </span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-fg-subtle">
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-[11.5px] leading-relaxed text-fg-subtle">
        These are goals you can take, not recommendations from us. Dates are
        approximate; your local announcement decides.
      </p>
    </section>
  );
}
