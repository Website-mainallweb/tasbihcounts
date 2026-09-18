"use client";

/**
 * The counter, in three genuinely different layouts.
 * Specification sections 14, 15, 16, 17, 18, 25, 29, 30, 69, 70, 71, 90, 133.
 *
 *   mobile   < 768   ONE SCREEN. Counter, controls and modes fit without a
 *                    scroll, with the name selector on the counter itself.
 *   tablet   768+    two columns: the counter, and ONE right rail holding both
 *                    panels stacked. The frame takes the tablet width rather
 *                    than sitting in a phone-shaped column with dead margins.
 *   desktop  1024+   three columns: library rail, stage, practice rail
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CounterStage, spawnRipple } from "./CounterStage";
import { RiteStage } from "./RiteStage";
import { LibraryPanel, PracticePanel } from "./Panels";
import { DhikrSheet } from "./DhikrSheet";
import { TargetSheet } from "./TargetSheet";
import { MoreSheet } from "./MoreSheet";
import { ResetSheet } from "./ResetSheet";
import { QuickChips } from "./QuickChips";
import { DhikrSelectBar } from "./DhikrSelectBar";
import { HeaderStats } from "./HeaderStats";
import { StatusBar } from "@/components/site/StatusBar";
import { setDeepLinkMiss } from "@/lib/deep-link";
import { useCounter } from "@/stores/counter-store";
import { useSettings } from "@/stores/settings-store";
import { view } from "@/core/counter";
import { formatCount, formatClock, MAX_TARGET } from "@/core/format";
import { msUntilLocalMidnight, toLocalDate } from "@/core/dates";
import { getDhikr, resolveDhikrId } from "@/content/dhikr";
import { getRoutine } from "@/content/routines";
import { riteView, RITE_LAPS } from "@/core/rites";
import { ticker, requestWakeLock, releaseWakeLock } from "@/lib/feedback";

type OpenSheet = "none" | "dhikr" | "target" | "more" | "reset";

/**
 * PWA shortcuts (section 91) and deep links (section 97).
 *
 * The manifest has always advertised "/?d=subhanallah" and
 * "/?r=after-salah-33-33-34", and nothing anywhere read them: every home-screen
 * shortcut opened the plain counter. This is what makes them mean something.
 *
 * A hash is only treated as a selection when it does not name a section on the
 * page, so "#99-names" still jumps to the 99 Names section, as the menu and the
 * footer both expect, while "#durood" selects Salawat.
 */
export interface Preselect {
  dhikrId?: string;
  routineId?: string;
}

/**
 * A landing page names its own dhikr (gap 20). An explicit link in the URL
 * still wins: someone who followed "/subhanallah-counter?d=astaghfirullah"
 * asked for istighfar, and the page they happened to land on does not override
 * what they asked for.
 */
function openDeepLink(preselect?: Preselect): void {
  if (typeof window === "undefined") return;
  const store = useCounter.getState();
  const params = new URLSearchParams(window.location.search);

  const routineParam = params.get("r");
  if (routineParam && getRoutine(routineParam)) {
    void store.startRoutine(routineParam);
    return;
  }

  // A routine name that does not resolve is a miss, not a reason to fall
  // through to the dhikr branch and open something unrelated.
  if (routineParam) {
    setDeepLinkMiss(routineParam);
  }

  const dhikrParam = params.get("d");
  const fromQuery = dhikrParam ? resolveDhikrId(dhikrParam) : null;
  if (fromQuery) {
    void store.selectDhikr(fromQuery);
    return;
  }
  if (dhikrParam) {
    // "?d=xyz123" used to open the default dhikr in silence, so the reader
    // counted the wrong thing believing the link had worked.
    setDeepLinkMiss(dhikrParam);
  }

  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (!hash || document.getElementById(hash)) {
    // Nothing in the URL asked for anything, so the page decides.
    if (preselect?.routineId && getRoutine(preselect.routineId)) {
      void store.startRoutine(preselect.routineId);
    } else if (preselect?.dhikrId) {
      const id = resolveDhikrId(preselect.dhikrId);
      if (id) void store.selectDhikr(id);
    }
    return;
  }
  if (getRoutine(hash)) {
    void store.startRoutine(hash);
    return;
  }
  const fromHash = resolveDhikrId(hash);
  if (fromHash) void store.selectDhikr(fromHash);
}


export function CounterTool({ preselect }: { preselect?: Preselect } = {}) {
  const s = useCounter();
  const settings = useSettings();
  const [sheet, setSheet] = useState<OpenSheet>("none");
  const [pressed, setPressed] = useState(false);
  const [immersive, setImmersive] = useState(false);

  const pointerId = useRef<number | null>(null);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const cancelled = useRef(false);
  const surfaceRef = useRef<HTMLButtonElement>(null);

  /** True while a Tawaf or Sa'i is under way and not yet finished. */
  const riteActive =
    s.state.mode === "rite" && s.state.count < (s.state.target ?? RITE_LAPS);

  useEffect(() => {
    settings.hydrate();
    void s.hydrate().then(() => openDeepLink(preselect));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The site's Library and Settings links are sheets of this counter rather
   * than pages (lib/nav.ts). They arrive as #library and #settings, from this
   * page or another one. The hash is removed once the sheet is up: it described
   * an action, and left in the URL it would reopen the sheet on every refresh. */
  useEffect(() => {
    const HASH_SHEETS: Record<string, OpenSheet> = { "#library": "dhikr", "#settings": "more" };
    const openFromHash = () => {
      const want = HASH_SHEETS[window.location.hash];
      if (!want) return;
      setSheet(want);
      try {
        history.replaceState(history.state, "", window.location.pathname + window.location.search);
      } catch {
        /* the sheet is open either way */
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  /* Section 12.2 and 90: leaving the tab PERSISTS, it does not seal. A session
   * never ends because someone glanced at another app. It ends after thirty
   * idle minutes, and whatever is still open when the page dies is sealed by
   * hydrate() on the next visit. */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void s.persist();
      else void s.sealIfIdle();
    };
    const onPageHide = () => void s.persist();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    // Rule 4: thirty minutes with no tap.
    const idle = setInterval(() => void s.sealIfIdle(), 60_000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      clearInterval(idle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Rule 5: at local midnight the session is split and Today starts again. A
   * page left open overnight must not keep yesterday's total on screen. */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    /**
     * A setTimeout scheduled for midnight does not survive a laptop lid.
     * Suspend the machine at 22:00 and wake it at 09:00 and the timer fires
     * eleven hours late, so a session opened yesterday is still open and today
     * total still shows yesterday. The date is therefore re-checked whenever
     * the page becomes visible, which is exactly when a sleeping machine
     * returns.
     */
    const rollIfNeeded = () => {
      const open = useCounter.getState().session;
      if (open && open.localDate !== toLocalDate()) {
        void s.flush("midnight-rollover").then(() => s.recomputeStats());
      } else {
        s.recomputeStats();
      }
    };

    const schedule = () => {
      timer = setTimeout(
        () => {
          rollIfNeeded();
          schedule();
        },
        msUntilLocalMidnight() + 1500,
      );
    };
    schedule();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Re-arm as well as re-check: the remaining time is now wrong.
      clearTimeout(timer);
      rollIfNeeded();
      schedule();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Wake lock (sections 51 and 52 for the rites, and the general setting).
   *
   * The setting is off by default, which is right for a tasbih: the screen is
   * being tapped, so it stays awake on its own, and holding a wake lock through
   * a long session costs battery for nothing.
   *
   * A rite is the opposite case. A lap of the Tawaf is minutes of walking with
   * no interaction at all, so the screen sleeps between laps and the next lap
   * has to be recorded through a lock screen. Section 51 lists Wake Lock as a
   * feature of the mode for exactly that reason, so an ACTIVE RITE requests it
   * whether or not the general setting is on, and gives it back the moment the
   * rite ends. It degrades silently: a browser without the API is unaffected,
   * and a refused request is not an error the reader should ever see. */
  const riteHoldsScreen = riteActive;

  useEffect(() => {
    const wanted = settings.wakeLock || riteHoldsScreen;
    if (wanted) void requestWakeLock(true);
    else void releaseWakeLock();
    const onVis = () => {
      // A wake lock is released by the browser whenever the page is hidden and
      // is not restored on its own, so it has to be re-requested on return.
      if (document.visibilityState === "visible" && wanted) {
        void requestWakeLock(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [settings.wakeLock, riteHoldsScreen]);

  useEffect(() => {
    if (s.state.timerSeconds === null) return;
    const id = setInterval(() => s.tickTimer(), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.state.timerSeconds === null]);

  useEffect(() => {
    if (!s.autoRunning || !s.state.autoIntervalMs) return;
    // true = this tick came from the timer, not from a person.
    const id = setInterval(() => s.tap(true), s.state.autoIntervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.autoRunning, s.state.autoIntervalMs]);

  // A round or a step is a passing note and fades on its own. A completed
  // target asks a question (section 134), so it waits for an answer — or for
  // the next tap, which is the answer "keep going".
  useEffect(() => {
    if (!s.milestone) return;
    if (s.milestone.kind === "target" || s.milestone.kind === "routine") return;
    const id = setTimeout(() => s.clearMilestone(), 2400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.milestone?.id]);

  /* ---------- full screen (section 16: the counter, nothing else) ----------
   *
   * Two layers, because the Fullscreen API is not dependable on a phone.
   * Safari on iOS refuses to fullscreen an arbitrary element, so the class on
   * <body> does the real work: header, footer and the whole page below the
   * fold go away and the counter takes the viewport. Native fullscreen is
   * requested on top of that wherever the browser allows it, which also hides
   * the browser's own chrome.
   */
  useEffect(() => {
    document.body.classList.toggle("is-immersive", immersive);
    return () => document.body.classList.remove("is-immersive");
  }, [immersive]);

  useEffect(() => {
    // Leaving fullscreen by F11 or the browser's own control must leave the
    // CSS layer too, or the page stays stripped with no way back.
    const onChange = () => {
      if (!document.fullscreenElement) setImmersive(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleImmersive = useCallback(() => {
    setImmersive((was) => {
      const next = !was;
      const el = document.documentElement;
      if (next) {
        // Failure is fine and expected on iOS; the CSS layer still applies.
        void Promise.resolve(el.requestFullscreen?.()).catch(() => {});
      } else if (document.fullscreenElement) {
        void Promise.resolve(document.exitFullscreen?.()).catch(() => {});
      }
      return next;
    });
  }, []);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const typing = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n) return false;
      return (
        n.tagName === "INPUT" ||
        n.tagName === "TEXTAREA" ||
        n.tagName === "SELECT" ||
        n.isContentEditable === true
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || sheet !== "none" || e.repeat) return;
      // The site's own dialogs (log in, the drawer) sit outside the counter; a
      // key pressed in one of them is not a count.
      if (e.target instanceof Element && e.target.closest("dialog, [role='dialog']")) return;
      if (document.querySelector("dialog[open]") || document.documentElement.classList.contains("nav-open")) return;
      if (e.key === "Escape") {
        if (immersive) {
          e.preventDefault();
          toggleImmersive();
        }
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        // In a rite the only thing that records a lap is the labelled button,
        // which handles its own Space and Enter natively. Counting here as well
        // would both double-count it and defeat the accidental-action
        // protection the mode exists to provide.
        //
        // Read from the store rather than from `s`: this listener is registered
        // on [sheet, immersive] only, so the `s` it closes over is whatever the
        // render at registration time held, and the mode may have changed since.
        if (useCounter.getState().state.mode === "rite") return;
        e.preventDefault();
        ticker.unlock();
        const el = document.querySelector("[data-counter-stage]");
        if (el) {
          const r = el.getBoundingClientRect();
          spawnRipple(r.left + r.width / 2, r.top + r.height / 2);
        }
        s.tap();
      } else if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        s.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, immersive]);

  /* ---------- pointer (sections 15.1 to 15.3) ----------
   *
   * Deliberately simple, because the first version was not and it broke on
   * real phones. Two things are gone:
   *
   *   setPointerCapture  touch already has implicit capture, and the explicit
   *                      call perturbs the enter/leave sequence
   *   onPointerLeave     with capture active it can arrive before pointerup,
   *                      which cleared the tracked id and made every later tap
   *                      a no-op. One dangling pointerdown killed the counter
   *                      for the rest of the session.
   *
   * A new primary pointer now always wins, so stale state can never wedge it.
   */
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Section 15.2: only the first finger counts. A second is not primary.
    if (!e.isPrimary) return;
    pointerId.current = e.pointerId;
    startPt.current = { x: e.clientX, y: e.clientY };
    cancelled.current = false;
    setPressed(true);
    ticker.unlock();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== pointerId.current || !startPt.current) return;
    const dx = e.clientX - startPt.current.x;
    const dy = e.clientY - startPt.current.y;
    // Section 15.5: a drag is a scroll, not a count.
    if (Math.hypot(dx, dy) > 12) cancelled.current = true;
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerId !== pointerId.current) return;
      const aborted = cancelled.current;
      pointerId.current = null;
      startPt.current = null;
      cancelled.current = false;
      setPressed(false);
      if (!aborted) {
        spawnRipple(e.clientX, e.clientY);
        s.tap();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** The browser took the gesture, or the pointer was lost. Never counts. */
  const onPointerAbort = useCallback(() => {
    pointerId.current = null;
    startPt.current = null;
    cancelled.current = false;
    setPressed(false);
  }, []);

  const dhikr =
    getDhikr(s.state.dhikrId) ?? s.customDhikr.find((d) => d.id === s.state.dhikrId);
  const routine = s.state.routine ? getRoutine(s.state.routine.routineId) : null;
  const v = view(s.state, settings.countdown);
  const beadCount = v.target && v.target <= 60 ? v.target : 33;

  /* ---------- Tawaf and Sa'i (sections 51, 52) ----------
   *
   * A rite is the same store, the same session and the same persistence in a
   * different mode; only the face and the way a lap is recorded differ. Every
   * branch below is guarded on this one flag rather than on the dhikr id, so
   * the mode is the single thing that decides.
   */
  const rite = s.state.mode === "rite" ? riteView(s.state.dhikrId, s.state.count) : null;

  const stage = (
    <CounterStage
      progress={v.progress}
      beads={beadCount}
      display={formatCount(v.display, settings.locale, settings.numerals)}
      target={v.target}
      targetLabel={
        v.target
          ? `${settings.countdown ? "left of " : "of "}${formatCount(
              v.target,
              settings.locale,
              settings.numerals,
            )}`
          : null
      }
      roundLine={
        v.roundSize
          ? `round ${v.roundNumber}${v.totalRounds ? ` / ${v.totalRounds}` : ""} · ${v.inRound}/${v.roundSize}`
          : null
      }
      timerLine={
        s.state.timerSeconds !== null ? `${formatClock(s.state.timerSeconds)} left` : null
      }
      pressed={pressed}
      milestoneId={s.milestone?.id ?? null}
      size="var(--stage-size)"
      countKey={v.display}
      bubbleKey={s.state.count}
      bubbleText={dhikr?.name ?? null}
      bubbleArabic={dhikr?.arabic ?? null}
      skin={settings.skin}
    />
  );

  const phrase = (
    <div className="tool-phrase mt-3 w-full max-w-[36ch] shrink-0 px-2 text-center md:mt-6">
      {dhikr?.arabic ? (
        <p className="arabic text-fg" lang="ar" dir="rtl">
          {dhikr.arabic}
        </p>
      ) : null}
      <p className="mt-2 font-display text-[clamp(1.15rem,2.2vw,1.5rem)] font-semibold text-fg">
        {dhikr?.name}
      </p>
      {dhikr?.meaning ? (
        <p className="tool-meaning mt-1 text-[13px] leading-snug text-fg-muted">
          {dhikr.meaning}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="relative">
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {s.announcement}
      </p>

      {/* ===================== THREE COLUMN GRID =====================
          The three-column rail layout now starts at lg (1024px), not xl. A
          landscape tablet — an iPad at 1024, an Android tablet — was getting
          the md two-column layout, which spans the counter across the whole
          width and drops both panels below the fold, so the tablet looked like
          a big centred phone with empty sides. At lg it becomes library ·
          stage · practice, and the horizontal space is actually used. */}
      <div
        data-tool-grid=""
        // Tablet is a real two-column layout: the counter on the left and BOTH
        // panels stacked in a rail on the right. It used to be one full-width
        // counter with the panels dumped below the fold, which is a phone
        // layout given more room rather than a tablet layout.
        className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_290px] md:items-start lg:grid-cols-[248px_minmax(0,1fr)_268px] lg:gap-6 xl:grid-cols-[300px_minmax(0,1fr)_320px] xl:gap-8 2xl:grid-cols-[360px_minmax(0,1fr)_380px]">

        {/* ---------- centre: first on every device ---------- */}
        <div
          data-counter-col=""
          className="order-1 flex min-w-0 flex-col md:sticky md:top-[calc(var(--header-h)+12px)] md:block lg:static lg:order-2"
          style={
            {
              containerType: "inline-size",
              // On a phone the tool is exactly one screen tall, so counting
              // never requires a scroll. On larger screens this is "auto".
              height: "var(--tool-h)",
              ["--stage-size" as string]: "min(78vw, var(--stage-cap, 320px))",
            } as React.CSSProperties
          }
        >
          <div data-header-stats="" className="shrink-0 lg:hidden"><HeaderStats
            round={v.roundSize ? v.roundNumber : null}
            totalRounds={v.totalRounds}
            today={s.today}
            streak={s.streak.current}
            locale={settings.locale}
            numerals={settings.numerals}
          /></div>

          <StatusBar />

          <DhikrSelectBar onOpen={() => setSheet("dhikr")} />

          <div className="hidden md:block">
            <QuickChips
              activeId={s.state.dhikrId}
              routineId={s.state.routine?.routineId ?? null}
              onSelect={(id) => void s.selectDhikr(id)}
              onStartRoutine={(id) => void s.startRoutine(id)}
              onOpenAll={() => setSheet("dhikr")}
            />
          </div>

          {routine ? (
            <div className="hidden md:block">
            <RoutineStepper
              title={routine.title}
              steps={routine.steps.map((st, i) => ({
                label: getDhikr(st.dhikrId)?.name ?? "",
                target: st.target,
                done: (s.state.routine?.completedSteps ?? []).includes(i),
                active: (s.state.routine?.stepIndex ?? 0) === i,
              }))}
              onExit={() => void s.exitRoutine()}
            />
            </div>
          ) : null}

          {/* In a rite the surface is a PLAIN CONTAINER, not a button.
              Nothing here records a lap except the labelled action inside
              RiteStage — see the accidental-action note in that file. Making it
              an inert button instead would be a lie to a screen reader, which
              would announce something pressable that does nothing. */}
          {rite ? (
            <div
              data-rite-surface=""
              className="tap-surface relative mx-auto flex w-full min-h-0 flex-1 flex-col items-center justify-center gap-1 md:mt-4 md:min-h-[min(56vh,460px)] md:flex-none md:justify-start"
            >
              <RiteStage
                view={rite}
                canUndo={s.undoStack.length > 0}
                onComplete={() => s.tap()}
                onUndo={() => s.undo()}
                format={(n) => formatCount(n, settings.locale, settings.numerals)}
              />
              {phrase}
            </div>
          ) : (
          <button
            ref={surfaceRef}
            type="button"
            aria-label={`Count ${dhikr?.name ?? "dhikr"}. Currently ${v.display}${
              v.target ? ` of ${v.target}` : ""
            }.`}
            className="tap-surface relative mx-auto flex w-full min-h-0 flex-1 flex-col items-center justify-center gap-1 md:mt-4 md:min-h-[min(56vh,460px)] md:flex-none md:justify-start"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerAbort}
            onLostPointerCapture={onPointerAbort}
            onContextMenu={(e) => e.preventDefault()}
          >
            {stage}
            {phrase}
            {s.state.count === 0 ? (
              <span className="tool-hint anim-fade mt-4 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
                Tap anywhere to count
              </span>
            ) : v.actual >= MAX_TARGET ? (
              // The counter clamps at seven digits, and used to do so in total
              // silence — a reader tapping a stationary number has no way to
              // tell a ceiling from a broken app.
              <span className="tool-hint anim-fade mt-4 max-w-[30ch] text-center text-[11.5px] leading-snug text-warm">
                This counter stops at 9,999,999. Finish the session to bank it
                and start again — nothing is lost.
              </span>
            ) : null}
          </button>
          )}

          {/* Control rail. Four equal columns on a phone, because the pill row
              it used to be ran 483px wide and pushed More clean off a 375px
              screen: the control was there, but on no phone could anyone see
              it. From md up there is room for the original pills. */}
          <div className="mt-2 grid shrink-0 grid-cols-4 items-stretch gap-1.5 lg:flex lg:justify-center lg:gap-2">
            <Control
              label={immersive ? "Exit" : "Full screen"}
              onClick={toggleImmersive}
              icon={
                immersive
                  ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
                  : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
              }
            />
            {rite ? (
              // A rite is seven. Offering a target picker over it would be
              // offering to change something that is not ours to change, and
              // the engine refuses it anyway — so the control that would do
              // nothing is replaced by the one that matters here.
              <Control
                label="Choose"
                primary
                onClick={() => setSheet("dhikr")}
                icon="M4 7h16M4 12h16M4 17h10"
              />
            ) : (
            <Control
              // A five-digit goal plus the word does not fit a quarter of a
              // 320px screen, and "Target 9,9…" tells nobody anything. Past
              // that width the number speaks for itself under the icon.
              label={
                v.target
                  ? v.target >= 10000
                    ? formatCount(v.target, settings.locale, settings.numerals)
                    : `Target ${formatCount(v.target, settings.locale, settings.numerals)}`
                  : "Target"
              }
              primary
              onClick={() => setSheet("target")}
              icon="M12 4a8 8 0 100 16 8 8 0 000-16zm0 5a3 3 0 100 6 3 3 0 000-6z"
            />
            )}
            <Control
              label="Reset"
              quiet
              onClick={() => setSheet("reset")}
              icon="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006 5.3M4 15a8 8 0 0014 3.7"
            />
            <Control
              label="More"
              onClick={() => setSheet("more")}
              icon="M5 12h.01M12 12h.01M19 12h.01"
            />
          </div>

          {/* Modes, visible on every device. Nothing important hides in a sheet. */}
          <div
            className="overflow-guard -mx-4 mt-2 flex shrink-0 gap-2 px-4 md:justify-center-safe"
            style={{ paddingBottom: "var(--tap-safe-bottom)" }}
            role="group"
            aria-label="Counting mode"
          >
            {/* Count up, countdown, timer and auto are tasbih modes. A rite is
                seven laps walked: none of them mean anything over it, and the
                engine refuses all three of target, rounds and countdown in rite
                mode, so a chip here would be a control that does nothing.
                Sound and haptic stay — they are feedback, and someone walking
                with the phone in hand wants both. */}
            {rite ? null : (
            <>
            <ModeChip
              label="Count up"
              active={!settings.countdown && s.state.timerSeconds === null && !s.autoRunning}
              // "Count up" means plain counting, so it has to clear the timer
              // too. Leaving a timer running behind it made the chip look
              // pressed and inactive at the same time.
              onClick={() => {
                settings.set("countdown", false);
                s.stopAuto();
                s.stopTimed();
              }}
            />
            <ModeChip
              label="Countdown"
              active={settings.countdown}
              onClick={() => settings.set("countdown", !settings.countdown)}
            />
            <ModeChip
              label={s.state.timerSeconds !== null ? "Timer · stop" : "Timer"}
              active={s.state.timerSeconds !== null}
              onClick={() =>
                s.state.timerSeconds !== null ? s.stopTimed() : s.startTimed(300)
              }
            />
            <ModeChip
              label={s.autoRunning ? "Auto · on" : "Auto"}
              active={s.autoRunning}
              onClick={() => (s.autoRunning ? s.stopAuto() : s.startAuto())}
            />
            </>
            )}
            <ModeChip
              label={settings.sound ? "Sound · on" : "Sound"}
              active={settings.sound}
              onClick={() => settings.toggle("sound")}
            />
            <ModeChip
              label={settings.vibration ? "Haptic · on" : "Haptic"}
              active={settings.vibration}
              onClick={() => settings.toggle("vibration")}
            />
          </div>
        </div>

        {/* On a tablet these two share ONE right-hand rail, stacked, so the
            counter keeps the width it needs and the panels are on screen
            rather than below the fold. On desktop they split into the two
            outer rails; on a phone they stack under the counter. */}
        <div
          data-panel-col=""
          className="@container order-2 min-w-0 md:order-2 md:row-span-2 md:grid md:gap-6 lg:order-3 lg:row-span-1 lg:block"
        >
          <PracticePanel section="all" />
          <div className="mt-6 md:mt-0 lg:hidden">
            <LibraryPanel onMore={() => setSheet("dhikr")} />
          </div>
        </div>

        {/* Desktop only: the library gets its own left rail. */}
        <div data-panel-col="" className="@container order-3 hidden min-w-0 lg:order-1 lg:block">
          <LibraryPanel onMore={() => setSheet("dhikr")} />
        </div>
      </div>

      {/* Section 134: reaching the target is a moment, not an event to sail
          past in silence. It offers a choice and destroys nothing. A round or a
          routine step is smaller news, so that stays the quiet pill it was.
          Both float, so neither costs a pixel of the one-screen phone layout. */}
      {s.milestone && (s.milestone.kind === "target" || s.milestone.kind === "routine") ? (
        <div
          role="status"
          // Sits above the rail and the mode chips, so it never covers a
          // control, and any further tap dismisses it (see the tap handler).
          className="anim-pop fixed inset-x-0 bottom-32 z-40 mx-auto w-[min(360px,calc(100vw-32px))] rounded-[var(--radius-lg)] border border-warm bg-surface p-4 shadow-float md:bottom-24"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <p className="text-[14.5px] font-medium text-warm">{s.milestone.label} ✓</p>
          <p className="mt-1 text-[12.5px] leading-snug text-fg-muted">
            Nothing is lost either way. Your count is already saved.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <CompletionAction label="Continue" onClick={() => s.clearMilestone()} />
            <CompletionAction
              label="New round"
              onClick={() => s.finishSession(true)}
            />
            <CompletionAction
              label="Finish"
              primary
              onClick={() => s.finishSession(false)}
            />
          </div>
        </div>
      ) : s.milestone ? (
        <div
          role="status"
          className="anim-pop pointer-events-none fixed inset-x-0 bottom-24 z-40 mx-auto w-fit rounded-full border border-warm bg-surface px-5 py-2.5 text-[13.5px] font-medium text-warm shadow-float"
        >
          {s.milestone.label}
        </div>
      ) : null}

      <DhikrSheet open={sheet === "dhikr"} onClose={() => setSheet("none")} />
      <TargetSheet open={sheet === "target"} onClose={() => setSheet("none")} />
      <MoreSheet open={sheet === "more"} onClose={() => setSheet("none")} />
      <ResetSheet open={sheet === "reset"} onClose={() => setSheet("none")} />
    </div>
  );
}

function RoutineStepper({
  title,
  steps,
  onExit,
}: {
  title: string;
  steps: { label: string; target: number; done: boolean; active: boolean }[];
  onExit: () => void;
}) {
  return (
    <div className="anim-slide mt-4 rounded-[var(--radius-md)] border border-accent-line bg-accent-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-accent">{title}</span>
        <button
          type="button"
          onClick={onExit}
          className="text-[11.5px] text-fg-muted underline-offset-2 hover:underline"
        >
          Leave
        </button>
      </div>
      <ol className="mt-2 flex items-center gap-1.5">
        {steps.map((st, i) => (
          <li key={i} className="flex min-w-0 flex-1 flex-col gap-1">
            <span
              className={`h-1.5 rounded-full transition-all duration-300 ${
                st.done ? "bg-accent" : st.active ? "bg-warm" : "bg-border-strong"
              }`}
            />
            <span
              className={`truncate text-[10.5px] ${
                st.active ? "font-semibold text-fg" : "text-fg-subtle"
              }`}
            >
              {st.label} ×{st.target}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Control({
  label,
  icon,
  onClick,
  disabled,
  primary,
  quiet,
  className,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  quiet?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[52px] min-w-0 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-md)] border px-1 text-[10.5px] font-medium transition-all duration-200 lg:min-h-[48px] lg:flex-row lg:gap-2 lg:rounded-full lg:px-4 lg:text-[13px] ${
        primary
          ? "border-accent bg-accent text-fg-on-accent shadow-soft hover:shadow-card"
          : quiet
            ? "border-transparent text-fg-subtle hover:bg-surface-sunken hover:text-danger"
            : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
      } ${disabled ? "cursor-not-allowed opacity-40" : "active:scale-[0.96]"} ${className ?? ""}`}
      style={{ transitionTimingFunction: "var(--ease-brand)" }}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d={icon}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="max-w-full truncate leading-tight">{label}</span>
    </button>
  );
}

function CompletionAction({
  label,
  onClick,
  primary,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[44px] rounded-full border px-2 text-[12.5px] font-medium transition-colors ${
        primary
          ? "border-accent bg-accent text-fg-on-accent"
          : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}

function ModeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[12.5px] font-medium transition-all duration-200 active:scale-[0.96] ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
      }`}
      style={{ minHeight: 44, transitionTimingFunction: "var(--ease-brand)" }}
    >
      {label}
    </button>
  );
}
