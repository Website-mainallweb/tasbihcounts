"use client";

/**
 * The dhikr selector, phone only.
 *
 * The chip row scrolls sideways, so on a phone most names are off screen and
 * the user has to hunt for them. bhaktinamjap.com puts a plain name selector
 * on the counter screen instead, and that is the right instinct: the current
 * name is always visible and every other name is one tap away.
 *
 * This is that control, with the Arabic kept alongside so the selection reads
 * correctly before you open anything.
 */

import { getDhikr } from "@/content/dhikr";
import { getRoutine } from "@/content/routines";
import { useCounter } from "@/stores/counter-store";

export function DhikrSelectBar({ onOpen }: { onOpen: () => void }) {
  const s = useCounter();
  const routine = s.state.routine ? getRoutine(s.state.routine.routineId) : null;
  const dhikr =
    getDhikr(s.state.dhikrId) ?? s.customDhikr.find((d) => d.id === s.state.dhikrId);

  const title = routine ? routine.title : (dhikr?.name ?? "Choose dhikr");
  // The transliteration is usually identical to the display name, so show the
  // meaning instead. Two identical lines read as a rendering bug.
  const sub = routine
    ? `Step ${(s.state.routine?.stepIndex ?? 0) + 1} of ${routine.steps.length}`
    : dhikr?.transliteration && dhikr.transliteration !== dhikr.name
      ? dhikr.transliteration
      : dhikr?.meaning;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`Change dhikr. Currently ${title}.`}
      className="dhikr-select-bar mt-3 flex w-full shrink-0 items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-2.5 text-left shadow-soft transition-all duration-200 active:scale-[0.985] md:hidden"
      style={{ transitionTimingFunction: "var(--ease-brand)", minHeight: 58 }}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="4" r="1.9" fill="currentColor" />
        </svg>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-tight text-fg">
          {title}
        </span>
        {sub ? (
          <span className="select-sub block truncate text-[11.5px] leading-tight text-fg-muted">
            {sub}
          </span>
        ) : null}
      </span>

      {dhikr?.arabic && !routine ? (
        <span
          className="arabic-sm shrink-0 text-fg-muted"
          lang="ar"
          dir="rtl"
          style={{ fontSize: 17, lineHeight: 1.5 }}
        >
          {dhikr.arabic}
        </span>
      ) : null}

      <span className="shrink-0 text-fg-subtle" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M8 10l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}
