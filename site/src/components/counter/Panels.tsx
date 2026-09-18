"use client";

/**
 * Side panels.
 * The lesson from the teardown: a feature the user cannot see does not exist.
 * On a tablet and a desktop these sit beside the counter. On a phone they
 * stack beneath it, and everything selectable is also reachable from the name
 * selector on the counter screen itself.
 */

import { useEffect, useState } from "react";
import { DHIKR } from "@/content/dhikr";
import { ROUTINES, routineTotal } from "@/content/routines";
import { ASMA } from "@/content/asma";
import { useCounter } from "@/stores/counter-store";
import { SeasonCard } from "./SeasonCard";
import { useSettings } from "@/stores/settings-store";
import { formatCount } from "@/core/format";
import { hasVibration, hasWakeLock } from "@/lib/feedback";
import {
  canOfferPace,
  learnedIntervalMs,
  paceLabel,
  SPEEDS,
  tapsLearned,
  type Speed,
} from "@/core/autocount";

/* ------------------------------------------------------------------ */
/* Library: every dhikr and routine, on screen                         */
/* ------------------------------------------------------------------ */

export function LibraryPanel({ onMore }: { onMore: () => void }) {
  const s = useCounter();

  return (
    <aside className="panel-in flex h-full flex-col gap-5">
      <PanelCard title="Guided routines" action={{ label: "All", onClick: onMore }}>
        <ul className="grid grid-cols-2 gap-1.5 xl:grid-cols-1">
          {ROUTINES.map((r) => {
            const active = s.state.routine?.routineId === r.id;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void s.startRoutine(r.id)}
                  className={`w-full min-h-[46px] rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-px hover:shadow-soft ${
                    active
                      ? "border-accent bg-accent-soft"
                      : "border-border bg-surface hover:border-border-strong"
                  }`}
                >
                  <span className="block text-[12.5px] font-medium leading-snug">{r.title}</span>
                  <span className="tabular mt-1 block text-[10.5px] text-fg-muted">
                    {r.steps.map((x) => x.target).join(" · ")} = {routineTotal(r)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PanelCard>

      <PanelCard title="Dhikr library" action={{ label: "Search", onClick: onMore }}>
        <ul className="thin-scroll grid grid-cols-2 gap-1 sm:grid-cols-3 xl:max-h-[46vh] xl:grid-cols-1 xl:overflow-y-auto xl:pe-1">
          {DHIKR.map((d) => {
            const active = !s.state.routine && d.id === s.state.dhikrId;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => void s.selectDhikr(d.id)}
                  className={`flex h-full min-h-[46px] w-full flex-col items-start justify-center gap-0.5 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-all duration-200 active:scale-[0.98] xl:flex-row xl:items-center xl:justify-between xl:gap-2 xl:border-transparent xl:py-2 ${
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-surface hover:border-border-strong xl:bg-transparent xl:hover:bg-surface-sunken"
                  }`}
                >
                  <span className="w-full truncate text-[13px] font-medium">{d.name}</span>
                  <span
                    className="arabic-sm shrink-0 text-fg-subtle"
          lang="ar"
          dir="rtl"
                    style={{ fontSize: 15, lineHeight: 1.6 }}
                  >
                    {d.arabic}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PanelCard>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Practice: stats, week strip, modes, feedback                        */
/* ------------------------------------------------------------------ */

export function PracticePanel({ section = "all" }: { section?: "all" | "stats" | "tools" }) {
  const showStats = section === "all" || section === "stats";
  const showTools = section === "all" || section === "tools";
  const s = useCounter();
  const st = useSettings();
  // Capability checks touch navigator, so they must not run during the server
  // render or the markup will not match on hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const n = (x: number) => formatCount(x, st.locale, st.numerals);

  const learned = tapsLearned(s.learner);
  const interval = learnedIntervalMs(s.learner);
  const canAuto = canOfferPace(s.learner) && interval !== null;
  // Count up, countdown, timer and auto are tasbih modes; a rite is seven laps
  // walked and offers none of them. Hiding the whole card keeps the rite's
  // right rail to what actually applies — practice stats and feedback.
  const isRite = s.state.mode === "rite";

  return (
    <aside className="panel-in flex h-full flex-col gap-5">
      <SeasonCard />

      {showStats ? (
      <PanelCard title="Your practice">
        <div className="grid grid-cols-3 gap-2">
          <MiniTile label="Today" value={n(s.today)} accent />
          <MiniTile
            label="Streak"
            value={s.streak.current > 0 ? `${s.streak.current}d` : "—"}
          />
          <MiniTile label="Lifetime" value={n(s.lifetime)} />
        </div>

        <div className="mt-3 flex items-end justify-between gap-1">
          {s.streak.week.map((d) => (
            <div key={d.localDate} className="flex flex-1 flex-col items-center gap-1.5">
              <span
                className={`w-full rounded-full transition-all duration-500 ${
                  d.done ? "bg-accent" : "bg-border"
                }`}
                style={{
                  height: d.done ? 28 : 10,
                  transitionTimingFunction: "var(--ease-brand-out)",
                }}
              />
              <span
                className={`text-[10px] font-medium uppercase ${
                  d.isToday ? "text-accent" : "text-fg-subtle"
                }`}
              >
                {d.label}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-fg-subtle">
          Continue whenever you are ready.
        </p>
      </PanelCard>
      ) : null}

      {showTools ? (
      <>

      {isRite ? null : (
      <PanelCard title="Mode">
        <div className="grid grid-cols-2 gap-2 @md:grid-cols-4 @3xl:grid-cols-2">
          <ModeButton
            label="Count up"
            active={!st.countdown && s.state.timerSeconds === null && !s.autoRunning}
            onClick={() => {
              st.set("countdown", false);
              s.stopAuto();
              s.stopTimed();
            }}
          />
          <ModeButton
            label="Countdown"
            active={st.countdown}
            onClick={() => st.set("countdown", !st.countdown)}
          />
          <ModeButton
            label={s.state.timerSeconds !== null ? "Stop timer" : "5 min timer"}
            active={s.state.timerSeconds !== null}
            onClick={() =>
              s.state.timerSeconds !== null ? s.stopTimed() : s.startTimed(300)
            }
          />
          <ModeButton
            label={s.autoRunning ? "Auto · on" : "Auto count"}
            active={s.autoRunning}
            disabled={!canAuto}
            onClick={() => (s.autoRunning ? s.stopAuto() : s.startAuto())}
          />
        </div>

        {canAuto ? (
          <div className="anim-slide mt-3">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-fg-subtle">
                {paceLabel(Math.round((interval ?? 1000) / s.autoSpeed), st.locale)}
              </span>
            </div>
            <div className="mt-1.5 flex gap-1">
              {SPEEDS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => s.setAutoSpeed(sp as Speed)}
                  className={`min-h-[36px] flex-1 rounded-full border text-[11px] font-medium transition-colors ${
                    s.autoSpeed === sp
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-fg-subtle hover:text-fg"
                  }`}
                >
                  {sp}x
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-fg-subtle">
            Tap at your own pace {learned}/10 times to unlock hands-free auto count.
          </p>
        )}
      </PanelCard>
      )}

      <PanelCard title="Feedback">
        <div className="space-y-1 @md:grid @md:grid-cols-3 @md:gap-2 @md:space-y-0 @3xl:block @3xl:space-y-1">
          <ToggleRow
            label="Sound"
            checked={st.sound}
            onChange={() => st.toggle("sound")}
          />
          <ToggleRow
            label="Vibration"
            checked={st.vibration}
            disabled={mounted && !hasVibration()}
            hint={mounted && !hasVibration() ? "Not supported here" : undefined}
            onChange={() => st.toggle("vibration")}
          />
          {mounted && hasWakeLock() ? (
            <ToggleRow
              label="Keep screen awake"
              checked={st.wakeLock}
              onChange={() => st.toggle("wakeLock")}
            />
          ) : null}
        </div>
      </PanelCard>

      <PanelCard title="99 Names">
        <div className="grid grid-cols-3 gap-1.5 @md:grid-cols-6 @3xl:grid-cols-3">
          {ASMA.slice(0, 6).map((a) => (
            <div
              key={a.index}
              className="rounded-[var(--radius-xs)] border border-border bg-surface px-1.5 py-2 text-center"
            >
              <span
                className="arabic-sm block text-fg"
          lang="ar"
          dir="rtl"
                style={{ fontSize: 15, lineHeight: 1.5 }}
              >
                {a.arabic}
              </span>
              <span className="mt-0.5 block truncate text-[9.5px] text-fg-subtle">
                {a.transliteration}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-fg-subtle">
          All {ASMA.length} Names with meanings.
        </p>
      </PanelCard>
      </>
      ) : null}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* shared bits                                                         */
/* ------------------------------------------------------------------ */

function PanelCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface-2 p-4 shadow-soft">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
          {title}
        </h3>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="-me-2 -my-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-2 text-[12px] font-medium text-accent transition-opacity hover:opacity-70"
          >
            {action.label}
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function MiniTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-sm)] border px-2 py-2.5 text-center ${
        accent ? "border-accent-line bg-accent-soft" : "border-border bg-surface"
      }`}
    >
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
        {label}
      </div>
      <div
        className={`tabular mt-0.5 font-display text-[17px] leading-none ${
          accent ? "text-accent" : "text-fg"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ModeButton({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-[var(--radius-sm)] border px-2 py-2.5 text-[12.5px] font-medium min-h-[44px] transition-all duration-200 ${
        active
          ? "border-accent bg-accent text-fg-on-accent shadow-soft"
          : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
      } ${disabled ? "cursor-not-allowed opacity-40" : "active:scale-[0.97]"}`}
      style={{ transitionTimingFunction: "var(--ease-brand)" }}
    >
      {label}
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-left transition-colors hover:bg-surface-sunken ${
        disabled ? "opacity-45" : ""
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[13px]">{label}</span>
        {hint ? <span className="block text-[11px] text-fg-subtle">{hint}</span> : null}
      </span>
      <span
        className={`relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors duration-200 ${
          checked ? "bg-accent" : "bg-border-strong"
        }`}
      >
        <span
          className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-soft transition-transform duration-200"
          style={{
            transform: `translateX(${checked ? 21 : 3}px)`,
            transitionTimingFunction: "var(--ease-brand)",
          }}
        />
      </span>
    </button>
  );
}
