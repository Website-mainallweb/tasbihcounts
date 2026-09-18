"use client";

/**
 * The citation block that was stored and never shown.
 * Specification sections 62 (sources UI), 20 (target labelling), 61 (review).
 *
 * Every dhikr has carried a `sources[]` array and a `reviewStatus` since the
 * first commit, and no screen rendered either. That failed the specification's
 * own section 62 and it failed the reader: "SubhanAllah, 33" with no citation
 * asks to be trusted, which is precisely what this product says it does not do.
 *
 * Three things appear here, and nothing else:
 *   - the source type and its reference, so it can be checked elsewhere
 *   - whether the number is source-backed or the reader's own goal
 *   - the review state, told honestly, including when review is not done
 */

import type { Dhikr, SourceRef, TargetOption } from "@/core/types";
import { REVIEW_COMPLETE, reviewNotice } from "@/content/review";

const TYPE_LABEL: Record<SourceRef["type"], string> = {
  quran: "Qur'an",
  hadith: "Hadith",
  scholarly: "Scholarly",
  "user-goal": "Your own goal",
  none: "No source claimed",
};

export function SourceNote({
  dhikr,
  compact,
}: {
  dhikr: Pick<Dhikr, "sources" | "targets" | "reviewStatus" | "name">;
  compact?: boolean;
}) {
  const sourced = dhikr.targets.filter((t) => t.kind === "source-backed");
  const own = dhikr.targets.filter((t) => t.kind === "user-goal");

  return (
    <div
      className={`rounded-[var(--radius-md)] border border-border bg-surface-sunken p-3 ${
        compact ? "" : "mt-4"
      }`}
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
        Where these numbers come from
      </h3>

      {dhikr.sources.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {dhikr.sources.map((s) => (
            <li key={s.label} className="text-[13px] leading-relaxed">
              <span className="me-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-accent">
                {TYPE_LABEL[s.type]}
              </span>
              {s.url ? (
                <a
                  href={s.url}
                  rel="noopener nofollow"
                  target="_blank"
                  className="text-fg underline underline-offset-2"
                >
                  {s.label}
                </a>
              ) : (
                <span className="text-fg">{s.label}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
          No source is claimed for this entry. Any number you set for it is your
          own goal.
        </p>
      )}

      {/* Section 20 is mandatory and was invisible: a number a reader chose is
          never allowed to look like a recommendation. */}
      {sourced.length > 0 || own.length > 0 ? (
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg-muted">
          {sourced.length > 0 ? (
            <>
              <strong className="text-fg">
                {sourced.map((t) => t.value).join(", ")}
              </strong>{" "}
              {sourced.length === 1 ? "is" : "are"} supported by the source above.{" "}
            </>
          ) : null}
          {own.length > 0 ? (
            <>Any other number is your own goal, and we make no claim about it.</>
          ) : null}
        </p>
      ) : null}

      <p
        className={`mt-2.5 border-t border-border pt-2.5 text-[12px] leading-relaxed ${
          REVIEW_COMPLETE ? "text-fg-muted" : "text-warm"
        }`}
      >
        {reviewNotice()}{" "}
        <a href="/report" className="underline underline-offset-2">
          Report an error
        </a>
        .
      </p>
    </div>
  );
}

/** The same disclosure where there is no single dhikr in view. */
export function ReviewNotice({ className }: { className?: string }) {
  return (
    <p
      className={`text-[12.5px] leading-relaxed ${
        REVIEW_COMPLETE ? "text-fg-muted" : "text-warm"
      } ${className ?? ""}`}
    >
      {reviewNotice()}{" "}
      <a href="/report" className="underline underline-offset-2">
        Report an error
      </a>
      .
    </p>
  );
}

export type { TargetOption };
