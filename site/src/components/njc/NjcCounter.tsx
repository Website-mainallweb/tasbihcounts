"use client";

/**
 * The counter, as the Nam Jap counter draws it: the numbered bead mala, the
 * control rail, the mode box, the practice and library rails, the sheets and the
 * full-screen mode — markup and styles (app/njc.css) carried over from it.
 *
 * What it counts is Tasbih Counts': the dhikr, the 99 Names, the routines and
 * the rites come from the Tasbih store (stores/counter-store.ts), every tap is
 * recorded by the ledger (lib/counter/ledger.ts), and choosing a dhikr opens the
 * Tasbih "Choose Dhikr" sheet unchanged.
 *
 * The engine it replaces was a vanilla script that owned its DOM; this is the
 * same behaviour written as a React view over the store, so there is one source
 * of truth for the count.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DhikrSheet } from "@/components/counter/DhikrSheet";
import { StatusBar } from "@/components/site/StatusBar";
import { stageSize } from "./counter-size";
import { useCounter } from "@/stores/counter-store";
import { LANGUAGES, useSettings } from "@/stores/settings-store";
import { allows, view } from "@/core/counter";
import { formatCount, MAX_TARGET } from "@/core/format";
import { msUntilLocalMidnight, toLocalDate } from "@/core/dates";
import { DHIKR, getDhikr, QUICK_IDS, resolveDhikrId } from "@/content/dhikr";
import { getRoutine } from "@/content/routines";
import { hasVibration, releaseWakeLock, requestWakeLock, ticker } from "@/lib/feedback";
import { clearDeviceData, readLocal, writeLocal } from "@/lib/storage";
import { setDeepLinkMiss } from "@/lib/deep-link";
import { pushOverlay } from "@/lib/overlay-history";
import * as Ledger from "@/lib/counter/ledger";
import { dayKey } from "@/lib/counter/day";
import type { ThemeChoice } from "@/core/types";

type SheetName = "none" | "dhikr" | "target" | "reset" | "more";
type Prefs = { bubbles: boolean; beads: boolean; autoMs: number; timerSec: number };

const DEFAULT_PREFS: Prefs = { bubbles: true, beads: true, autoMs: 1500, timerSec: 300 };
/** A round, when no target is set: one pass of a 33-bead tasbih (lib/counter/ledger.ts). */
const ROUND = 33;
const COMMON_TARGETS = [33, 99, 100, 313, 1000];
const ROUND_SIZES = [0, 11, 33, 100];
const AUTO_SPEEDS = [1000, 1500, 2000, 3000];
const TIMER_LENGTHS = [300, 600, 900, 1200, 1800, 2700, 3600];
const THEMES: [ThemeChoice, string][] = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
  ["noor", "Midnight Noor"],
  ["heritage", "Emerald Heritage"],
];
const HIST_SHORT = 3;

const CX = 50;
const CY = 50;
const R_OUT = 45;
const CIRC = 2 * Math.PI * 39.4;

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ---------- deep links: /?d=subhanallah, /?r=after-salah-33-33-34, /#durood ---------- */
function openDeepLink(): void {
  const store = useCounter.getState();
  const params = new URLSearchParams(window.location.search);
  const r = params.get("r");
  if (r && getRoutine(r)) return void store.startRoutine(r);
  if (r) setDeepLinkMiss(r);
  const d = params.get("d");
  const fromQuery = d ? resolveDhikrId(d) : null;
  if (fromQuery) return void store.selectDhikr(fromQuery);
  if (d) setDeepLinkMiss(d);
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (!hash || document.getElementById(hash)) return;
  if (getRoutine(hash)) return void store.startRoutine(hash);
  const fromHash = resolveDhikrId(hash);
  if (fromHash) void store.selectDhikr(fromHash);
}

function beadCount(tg: number): number {
  if (tg <= 60) return Math.max(tg, 1);
  return tg % 56 === 0 ? 56 : tg % 50 === 0 ? 50 : 54;
}
function beadAt(i: number, n: number): [number, number] {
  const a = -Math.PI / 2 + ((i + 0.5) * Math.PI * 2) / n;
  return [Number((CX + R_OUT * Math.cos(a)).toFixed(2)), Number((CY + R_OUT * Math.sin(a)).toFixed(2))];
}
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function NjcCounter() {
  const s = useCounter();
  const st = useSettings();
  const ledger = useSyncExternalStore(Ledger.subscribe, Ledger.getView, Ledger.getServerView);

  const [sheet, setSheet] = useState<SheetName>("none");
  const [fs, setFs] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [armed, setArmed] = useState<string | null>(null);
  const [targetIn, setTargetIn] = useState("");
  const [targetErr, setTargetErr] = useState("");
  /* Read once mounted: the server cannot know, and guessing splits the render. */
  const [canVibrate, setCanVibrate] = useState(false);
  useEffect(() => setCanVibrate(hasVibration()), []);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const surfRef = useRef<HTMLButtonElement>(null);
  const digitsRef = useRef<HTMLSpanElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      writeLocal("njcPrefs", next);
      return next;
    });

  /* ---------- boot ---------- */
  useEffect(() => {
    st.hydrate();
    void s.hydrate().then(openDeepLink);
    setFavs(readLocal<string[]>("favs", []));
    setPrefsState({ ...DEFAULT_PREFS, ...readLocal<Partial<Prefs>>("njcPrefs", {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* #library and #settings, from this page or another: open the sheet, drop the hash. */
  useEffect(() => {
    const HASH: Record<string, SheetName> = { "#library": "dhikr", "#settings": "more" };
    const openFromHash = () => {
      const want = HASH[window.location.hash];
      if (!want) return;
      setSheet(want);
      try {
        history.replaceState(history.state, "", window.location.pathname + window.location.search);
      } catch {
        /* open either way */
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  /* Leaving the tab persists; thirty idle minutes seal the session. */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") void useCounter.getState().persist();
      else void useCounter.getState().sealIfIdle();
    };
    const onHide = () => void useCounter.getState().persist();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    const idle = setInterval(() => void useCounter.getState().sealIfIdle(), 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      clearInterval(idle);
    };
  }, []);

  /* Local midnight: the session splits and Today starts again. */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const roll = () => {
      const c = useCounter.getState();
      if (c.session && c.session.localDate !== toLocalDate()) void c.flush("midnight-rollover").then(() => c.recomputeStats());
      else c.recomputeStats();
    };
    const schedule = () => {
      timer = setTimeout(() => {
        roll();
        schedule();
      }, msUntilLocalMidnight() + 1500);
    };
    schedule();
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      roll();
      schedule();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  /* ---------- what is being counted ---------- */
  const routine = s.state.routine ? getRoutine(s.state.routine.routineId) : null;
  const stepIndex = s.state.routine?.stepIndex ?? 0;
  const curId = (routine && routine.steps[stepIndex]?.dhikrId) || s.state.dhikrId;
  const dhikr = getDhikr(curId) ?? s.customDhikr.find((x) => x.id === curId);
  const arabic = dhikr?.arabic?.trim() || dhikr?.name || "";
  const translit = dhikr?.transliteration || dhikr?.name || "";
  const meaning = dhikr?.meaning || "";
  const nameLine = dhikr?.name || translit;
  const rite = s.state.mode === "rite";
  const numerals = st.numerals;
  const fmt = useCallback((n: number) => formatCount(n, st.locale || "en", numerals), [st.locale, numerals]);

  const v = view(s.state, st.countdown && allows(s.state.mode, "countdown"));
  const tg = v.target;
  const beadsTarget = tg || ROUND;
  const progress = tg ? v.progress : ((v.actual % ROUND) / ROUND) * 100;
  const display = fmt(v.display);
  const targetLine = tg
    ? st.countdown && allows(s.state.mode, "countdown")
      ? `${fmt(Math.min(v.actual, tg))} of ${fmt(tg)}`
      : `of ${fmt(tg)}`
    : "Free count";
  const roundLine = routine
    ? `Step ${fmt(stepIndex + 1)} of ${fmt(routine.steps.length)}`
    : v.roundSize
      ? `Round ${fmt(v.roundNumber)}${v.totalRounds ? ` / ${fmt(v.totalRounds)}` : ""}`
      : tg && v.actual > tg
        ? `Round ${fmt(Math.ceil(v.actual / tg))}`
        : tg
          ? "Round 1"
          : null;
  const timerLine = s.state.timerSeconds !== null ? mmss(s.state.timerSeconds) : null;
  const longName = arabic.length > 22 ? 2 : arabic.length > 12 ? 1 : 0;

  /* ---------- the practice, from the ledger ---------- */
  const today = ledger.today;
  const hist = ledger.hist;
  const practice = useMemo(() => {
    const keys = Object.keys(hist).filter((k) => hist[k] && hist[k].c > 0).sort();
    let best = 0;
    let time = 0;
    let rounds = 0;
    for (const k of keys) {
      best = Math.max(best, hist[k].c);
      time += hist[k].s || 0;
    }
    for (const k of Object.keys(hist)) rounds += hist[k]?.r || 0;
    const t = hist[dayKey()] ?? { c: 0, r: 0, s: 0 };
    const mins = (t.s || 0) / 60000;
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const k = dayKey(d);
      return { c: hist[k]?.c ?? 0, label: d.toLocaleDateString(st.locale || "en", { weekday: "short" }).slice(0, 3), now: k === dayKey() };
    });
    const max = Math.max(1, ...week.map((w) => w.c));
    return { keys, best, time, rounds, pace: mins >= 1 ? Math.round(t.c / mins) : null, week, max };
  }, [ledger, st.locale]); // eslint-disable-line react-hooks/exhaustive-deps -- the ledger view is new on every change; its hist object is not
  const streakNow = ledger.streak.current;
  const lifetime = ledger.lifetime;
  const hm = (ms: number) => {
    const m = Math.round(ms / 60000);
    return m < 60 ? `${fmt(m)}m` : `${(m / 60).toFixed(1)}h`;
  };
  const histRows = practice.keys.slice().reverse();
  const histMore = histRows.length > HIST_SHORT;
  const histShown = histMore && !histOpen ? histRows.slice(0, HIST_SHORT) : histRows;

  /* ---------- the library ---------- */
  const all = useMemo(() => [...s.customDhikr, ...DHIKR], [s.customDhikr]);
  const libList = useMemo(() => {
    const fav = (id: string) => (favs.includes(id) ? 0 : 1);
    return all.slice().sort((a, b) => fav(a.id) - fav(b.id)).slice(0, 10);
  }, [all, favs]);
  const quickIds = useMemo(
    () => [...favs, ...QUICK_IDS].filter((id, i, a) => a.indexOf(id) === i).slice(0, 5),
    [favs],
  );
  const toggleFav = (id: string) =>
    setFavs((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      writeLocal("favs", next);
      return next;
    });

  /* ---------- feedback ---------- */
  const ripple = (x?: number, y?: number) => {
    const fx = fxRef.current;
    if (x == null || y == null || !fx || reducedMotion()) return;
    const r = fx.getBoundingClientRect();
    if (x < r.left - 40 || x > r.right + 40 || y < r.top - 40 || y > r.bottom + 40) return;
    const el = document.createElement("span");
    el.className = "njc-ripple";
    el.style.left = `${x - r.left}px`;
    el.style.top = `${y - r.top}px`;
    fx.appendChild(el);
    setTimeout(() => el.remove(), 640);
  };
  const bubble = (count: number) => {
    const fx = fxRef.current;
    if (!prefs.bubbles || !fx || reducedMotion() || !dhikr) return;
    const live = fx.querySelectorAll(".njc-bubble");
    if (live.length > 3) live[0].remove();
    const ar = count % 2 === 0 && !!dhikr.arabic;
    const el = document.createElement("span");
    el.className = "njc-bubble" + (ar ? " dv" : "");
    if (ar) el.dir = "rtl";
    el.textContent = ar ? arabic : translit;
    el.style.setProperty("--drift", `${Math.round((Math.random() * 2 - 1) * 46)}px`);
    fx.appendChild(el);
    setTimeout(() => el.remove(), 2100);
  };
  const burst = () => {
    const fx = fxRef.current;
    if (!fx || reducedMotion()) return;
    const el = document.createElement("span");
    el.className = "njc-burst";
    fx.appendChild(el);
    setTimeout(() => el.remove(), 800);
  };

  /* A round, a step or a target just completed. */
  const lastMile = useRef<number | null>(null);
  useEffect(() => {
    const m = s.milestone;
    if (!m || m.id === lastMile.current) return;
    lastMile.current = m.id;
    burst();
    if (m.kind === "target" || m.kind === "routine") return;
    const t = setTimeout(() => useCounter.getState().clearMilestone(), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.milestone?.id]);

  /* The number rolls in. A Web Animation restarts without a forced layout. */
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    const el = digitsRef.current;
    if (lastShown.current !== null && lastShown.current !== display && el?.animate && !reducedMotion()) {
      el.animate([{ opacity: 0, transform: "translate3d(0,.42em,0)" }, { opacity: 1, transform: "none" }], {
        duration: 220,
        easing: "cubic-bezier(.16,1,.3,1)",
      });
    }
    lastShown.current = display;
  }, [display]);

  /* ---------- counting ---------- */
  const count = (x?: number, y?: number) => {
    const c = useCounter.getState();
    if (c.milestone?.kind === "target" || c.milestone?.kind === "routine") c.clearMilestone();
    ticker.unlock();
    const before = c.state.count;
    c.tap();
    const after = useCounter.getState().state.count;
    if (after === before && !useCounter.getState().state.routine) return;
    ripple(x, y);
    bubble(after);
  };
  const undo = () => useCounter.getState().undo();

  /* A tap is a short press that did not travel (a scroll is not a count). */
  const press = useRef({ at: 0, x: 0, y: 0, moved: false });
  useEffect(() => {
    const surf = surfRef.current;
    if (!surf) return;
    // A touch is followed by compatibility mouse events and a click; the tap is
    // handled on pointerup, so the rest must not reach a sheet that just opened.
    const onTouchEnd = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    surf.addEventListener("touchend", onTouchEnd, { passive: false });
    return () => surf.removeEventListener("touchend", onTouchEnd);
  }, []);

  /* ---------- auto count and the timer ---------- */
  useEffect(() => {
    if (s.state.timerSeconds === null) return;
    const id = setInterval(() => useCounter.getState().tickTimer(), 1000);
    return () => clearInterval(id);
  }, [s.state.timerSeconds === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!s.autoRunning || !s.state.autoIntervalMs) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      count();
    }, s.state.autoIntervalMs);
    return () => clearInterval(id);
  }, [s.autoRunning, s.state.autoIntervalMs]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Auto ends with each completed target: nobody should count on unattended. */
  useEffect(() => {
    if (s.autoRunning && v.isComplete) s.stopAuto();
  }, [s.autoRunning, v.isComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAuto = () => {
    if (rite) return;
    useCounter.setState((p) => ({
      autoRunning: true,
      lastHumanAt: Date.now(),
      state: { ...p.state, autoIntervalMs: prefs.autoMs },
    }));
  };

  const mode: "up" | "down" | "timer" | "auto" = s.autoRunning
    ? "auto"
    : s.state.timerSeconds !== null
      ? "timer"
      : st.countdown
        ? "down"
        : "up";
  const setMode = (m: "up" | "down" | "timer" | "auto") => {
    const c = useCounter.getState();
    if (m !== "auto" && c.autoRunning) c.stopAuto();
    if (m !== "timer" && c.state.timerSeconds !== null) c.stopTimed();
    if (m === "up") st.set("countdown", false);
    if (m === "down") st.set("countdown", true);
    if (m === "timer") {
      if (c.state.timerSeconds !== null) c.stopTimed();
      else c.startTimed(prefs.timerSec);
    }
    if (m === "auto") {
      if (c.autoRunning) c.stopAuto();
      else startAuto();
    }
  };

  /* Wake lock: the setting, and always while a rite is under way. */
  const riteActive = rite && s.state.count < (s.state.target ?? 7);
  useEffect(() => {
    const wanted = st.wakeLock || riteActive || s.state.timerSeconds !== null;
    if (wanted) void requestWakeLock(true);
    else void releaseWakeLock();
    const onVis = () => {
      if (document.visibilityState === "visible" && wanted) void requestWakeLock(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [st.wakeLock, riteActive, s.state.timerSeconds !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- sheets ---------- */
  const openSheet = (name: SheetName) => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setArmed(null);
    setTargetErr("");
    setSheet(name);
  };
  const closeSheet = () => setSheet("none");

  useEffect(() => {
    if (sheet === "none") return;
    // Back closes the sheet, not the page.
    const release = pushOverlay(() => setSheet("none"));
    if (sheet === "dhikr") return release;
    const html = document.documentElement;
    const root = rootRef.current;
    const y = window.scrollY;
    html.classList.add("njc-sheet-open");
    html.style.overflow = "hidden";
    const first = rootRef.current?.querySelector<HTMLElement>(".njc-sheet.open [data-close]");
    first?.focus({ preventScroll: true });
    return () => {
      release();
      html.classList.remove("njc-sheet-open");
      html.style.overflow = "";
      if (!root?.classList.contains("njc-faux-fs")) {
        try {
          window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
        } catch {
          window.scrollTo(0, y);
        }
      }
      openerRef.current?.focus?.({ preventScroll: true });
    };
  }, [sheet]);

  /* Clear today and Erase everything ask for a second tap within five seconds. */
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  /* ---------- full screen ---------- */
  const toggleFs = useCallback(() => {
    if (!document.fullscreenElement) {
      setFs((was) => {
        if (was) return false;
        void Promise.resolve(document.documentElement.requestFullscreen?.()).catch(() => {});
        return true;
      });
    } else void document.exitFullscreen();
  }, []);
  useEffect(() => {
    const onChange = () => {
      const on = !!document.fullscreenElement;
      setFs((was) => (on !== was ? on : was));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("njc-fs-lock", fs);
    return () => document.documentElement.classList.remove("njc-fs-lock");
  }, [fs]);

  /* ---------- keyboard ---------- */
  const ringInView = () => {
    if (rootRef.current?.classList.contains("immersive")) return true;
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || r.height === 0) return false;
    return Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0) >= r.height / 2;
  };
  const keyState = useRef({ sheet, fs, rite });
  useEffect(() => {
    keyState.current = { sheet, fs, rite };
  }, [sheet, fs, rite]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keyState.current;
      if (e.key === "Escape") {
        if (k.sheet !== "none" && k.sheet !== "dhikr") return closeSheet();
        if (k.fs && k.sheet === "none") return toggleFs();
        return;
      }
      if (k.sheet !== "none") return;
      const tn = (e.target as HTMLElement | null)?.tagName || "";
      if (tn === "INPUT" || tn === "TEXTAREA" || tn === "SELECT") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("dialog, [role='dialog']")) return;
      if (document.querySelector("dialog[open]") || document.documentElement.classList.contains("nav-open")) return;
      // A focused control owns its keys; only the ring, or nothing focused, counts.
      const focused =
        e.target instanceof Element
          ? e.target.closest("a[href],button,summary,select,[role='button'],[role='switch'],[tabindex]")
          : null;
      const surf = surfRef.current;
      if (focused && focused !== surf) return;
      if (focused !== surf && /^(Space|Enter|NumpadEnter|Backspace)$/.test(e.code) && !ringInView()) return;
      if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        if (e.repeat) return;
        count();
      } else if (e.code === "Backspace" || e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (!e.repeat) undo();
      } else if ((e.key === "f" || e.key === "F") && !e.repeat) {
        toggleFs();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- the ring's size, from the room actually left around it ---------- */
  const sizeRef = useRef({ pending: 0, w: 0, h: 0 });
  const sizeStage = useCallback(() => {
    if (sizeRef.current.pending) return;
    sizeRef.current.pending = window.setTimeout(() => {
      sizeRef.current.pending = 0;
      const R = rootRef.current;
      if (!R) return;
      const col = R.querySelector<HTMLElement>(".njc-col");
      if (!col) return;
      R.style.setProperty("--njc-coltop", `${Math.round(col.getBoundingClientRect().top - R.getBoundingClientRect().top)}px`);
      const size = stageSize(R);
      if (size != null) stageRef.current?.style.setProperty("--stage-px", `${size}px`);
    }, 0);
  }, []);
  useEffect(() => {
    const R = rootRef.current;
    if (!R) return;
    sizeRef.current.w = window.innerWidth;
    sizeRef.current.h = window.innerHeight;
    sizeStage();
    const onViewport = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // A phone's URL bar sliding away is not a new screen; a rotation is.
      if (R.classList.contains("immersive") || w !== sizeRef.current.w || Math.abs(h - sizeRef.current.h) > 140) {
        sizeRef.current.w = w;
        sizeRef.current.h = h;
        sizeStage();
      }
    };
    const onRotate = () => {
      sizeRef.current.w = 0;
      setTimeout(sizeStage, 120);
    };
    window.addEventListener("resize", onViewport);
    window.addEventListener("orientationchange", onRotate);
    window.visualViewport?.addEventListener("resize", onViewport);
    let roW = 0;
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          const w = Math.round(entries[0].contentRect.width);
          if (w === roW) return;
          roW = w;
          sizeStage();
        })
      : null;
    ro?.observe(R);
    void document.fonts?.ready.then(sizeStage);
    return () => {
      window.removeEventListener("resize", onViewport);
      window.removeEventListener("orientationchange", onRotate);
      window.visualViewport?.removeEventListener("resize", onViewport);
      ro?.disconnect();
    };
  }, [sizeStage]);
  /* What sits around the ring changed: measure again. */
  useEffect(() => {
    sizeStage();
    const t = setTimeout(() => {
      sizeRef.current.w = window.innerWidth;
      sizeRef.current.h = window.innerHeight;
      sizeStage();
    }, 300);
    return () => clearTimeout(t);
  }, [fs, curId, longName, ledger.notice?.id, sizeStage, s.hydrated]);

  /* ---------- the bead ring ---------- */
  const n = beadCount(beadsTarget);
  const beadR = Math.min(2.25, ((Math.PI * R_OUT) / n) * 0.86);
  const beadsOn = Math.min(n, Math.ceil((Math.max(0, Math.min(100, progress)) / 100) * n - 1e-6));
  const beads = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const [x, y] = beadAt(i, n);
        const label = String(i === n - 1 ? beadsTarget : Math.round(((i + 1) * beadsTarget) / n));
        const size = beadR * (label.length <= 2 ? 0.98 : label.length === 3 ? 0.76 : 0.6);
        return { x, y, label: formatCount(Number(label), "en", numerals), size };
      }),
    [n, beadsTarget, beadR, numerals],
  );
  const halo = beadsOn > 0 ? beadAt(beadsOn - 1, n) : null;

  /* ---------- target sheet ---------- */
  const targetOptions = [...new Set([...(dhikr?.targets ?? []).map((t) => t.value), ...COMMON_TARGETS])]
    .sort((a, b) => a - b)
    .slice(0, 9);
  const canTarget = allows(s.state.mode, "target");
  const canRounds = allows(s.state.mode, "rounds");
  const setCustomTarget = () => {
    const t = /^\s*\d+\s*$/.test(targetIn) ? Number(targetIn) : NaN;
    if (!Number.isFinite(t) || t < 1 || t > MAX_TARGET || Math.floor(t) !== t) {
      setTargetErr(`Enter a whole number from 1 to ${fmt(MAX_TARGET)}`);
      return;
    }
    setTargetErr("");
    s.setTarget(t, "user-goal");
    setTargetIn("");
    closeSheet();
  };

  /* ---------- labels ---------- */
  const surfaceLabel = `Count ${dhikr?.name ?? "dhikr"}. Currently ${fmt(v.display)}${tg ? ` of ${fmt(tg)}` : ""}.`;
  const targetLg = rite ? "Tawaf" : tg ? `Target ${fmt(tg)}` : "Target";
  const targetSm = tg ? fmt(tg) : "Target";
  const statLong = (txt: string) => (txt.length >= 11 ? "2" : txt.length >= 9 ? "1" : undefined);
  const todayTxt = fmt(today);
  const roundsTxt = fmt(practice.rounds);
  const lifeTxt = fmt(lifetime);
  const mile = s.milestone;

  return (
    <>
      <div
        ref={rootRef}
        className={`njc${fs ? " immersive njc-faux-fs" : ""}${prefs.beads ? "" : " njc-nobeads"}`}
        id="njc"
        data-long={longName}
        // The pre-paint script (TasbihCounter) writes the ring's size here first.
        suppressHydrationWarning
      >
        <div className="njc-glow" aria-hidden="true" />
        <div className="njc-veil" aria-hidden="true" />

        <div className="njc-shell">
          <p className="njc-sr" aria-live="polite" aria-atomic="true">
            {s.announcement}
          </p>

          <div className="njc-grid">
            {/* ============ LEFT RAIL (desktop) ============ */}
            <div className="njc-rail left">
              <div className="njc-panel">
                <div className="njc-ptitle">Library</div>
                <LibList list={libList} favs={favs} current={curId} onPick={(id) => void s.selectDhikr(id)} onFav={toggleFav} />
                <button type="button" className="njc-btn block" style={{ marginTop: 12 }} onClick={() => openSheet("dhikr")}>
                  All dhikr
                </button>
              </div>
            </div>

            {/* ============ CENTRE ============ */}
            <div className="njc-col">
              {ledger.notice ? (
                <div
                  className={`njc-notice${ledger.notice.tone ? ` ${ledger.notice.tone}` : ""}`}
                  role="status"
                  data-ledger-notice=""
                >
                  <p>{ledger.notice.text}</p>
                  {ledger.notice.actionLabel ? (
                    <button
                      type="button"
                      className="act"
                      onClick={() => {
                        const act = ledger.notice?.onAction;
                        Ledger.dismissNotice();
                        act?.();
                      }}
                    >
                      {ledger.notice.actionLabel}
                    </button>
                  ) : null}
                  <button type="button" className="x" aria-label="Dismiss" onClick={() => Ledger.dismissNotice()}>
                    ✕
                  </button>
                </div>
              ) : null}

              <div className="tc njc-status">
                <StatusBar />
              </div>

              <div className="njc-hstats">
                <div className="njc-hstat em">
                  <i>Today</i>
                  <b data-stat="today" data-long={statLong(todayTxt)}>{todayTxt}</b>
                </div>
                <div className="njc-hstat">
                  <i>Rounds</i>
                  <b data-long={statLong(roundsTxt)}>{roundsTxt}</b>
                </div>
                <div className="njc-hstat">
                  <i>Total</i>
                  <b data-long={statLong(lifeTxt)}>{lifeTxt}</b>
                </div>
              </div>

              <button type="button" className="njc-selectbar" aria-haspopup="dialog" onClick={() => openSheet("dhikr")}>
                <span className="dot" aria-hidden="true">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
                    <circle cx="12" cy="4" r="1.9" fill="currentColor" />
                  </svg>
                </span>
                <span className="txt">
                  <b>{nameLine}</b>
                  <span>{routine ? `${routine.title} · step ${fmt(stepIndex + 1)} of ${fmt(routine.steps.length)}` : meaning}</span>
                </span>
                {dhikr?.arabic ? (
                  <span className="dv" lang="ar">
                    {arabic}
                  </span>
                ) : null}
                <span style={{ flexShrink: 0, color: "var(--fg-subtle)" }} aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M8 10l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>

              <div className="njc-chiprow" id="njcQuick" role="group" aria-label="Quick dhikr">
                {quickIds.map((id) => {
                  const x = all.find((d) => d.id === id);
                  if (!x) return null;
                  return (
                    <button key={id} type="button" className="njc-chip" aria-pressed={id === curId} onClick={() => void s.selectDhikr(id)}>
                      {x.name}
                    </button>
                  );
                })}
                <button type="button" className="njc-chip outline" onClick={() => openSheet("dhikr")}>
                  All ▾
                </button>
              </div>

              <button
                ref={surfRef}
                type="button"
                className="njc-surface"
                id="njcSurface"
                aria-label={surfaceLabel}
                data-counter-stage=""
                onPointerDown={(e) => {
                  press.current = { at: Date.now(), x: e.clientX, y: e.clientY, moved: false };
                }}
                onPointerMove={(e) => {
                  if (Math.abs(e.clientX - press.current.x) > 12 || Math.abs(e.clientY - press.current.y) > 12) press.current.moved = true;
                }}
                onPointerUp={(e) => {
                  if (press.current.moved || Date.now() - press.current.at > 800) return;
                  count(e.clientX, e.clientY);
                }}
                onClick={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
              >
                <span className="njc-fsname" aria-hidden="true">
                  <b className="dev">{arabic}</b>
                </span>
                <div className="njc-stage" id="njcStage" ref={stageRef} suppressHydrationWarning>
                  <span className="njc-halo" aria-hidden="true" />
                  <svg className="njc-svg" viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" focusable="false">
                    <defs>
                      <radialGradient id="njcDisc">
                        <stop offset="60%" stopColor="var(--surface)" stopOpacity="0" />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.07" />
                      </radialGradient>
                    </defs>
                    <circle cx="50" cy="50" r="39.4" fill="url(#njcDisc)" />
                    <circle className="njc-track" cx="50" cy="50" r="39.4" fill="none" stroke="var(--border)" strokeWidth="1.7" />
                    <circle cx="50" cy="50" r="37.9" fill="none" stroke="var(--accent-line)" strokeWidth=".35" opacity=".6" />
                    <circle
                      className="njc-arc"
                      cx="50"
                      cy="50"
                      r="39.4"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeDasharray={CIRC.toFixed(2)}
                      strokeDashoffset={(CIRC * (1 - Math.max(0, Math.min(100, progress)) / 100)).toFixed(2)}
                      transform="rotate(-90 50 50)"
                    />
                    {prefs.beads ? (
                      <g id="njcBeads">
                        <circle
                          className="njc-bead-halo"
                          r={(beadR * 1.75).toFixed(2)}
                          cx={halo?.[0]}
                          cy={halo?.[1]}
                          style={{ display: halo ? "inline" : undefined }}
                        />
                        {beads.map((b, i) => (
                          <g key={i} className={i < beadsOn ? "njc-bead on" : "njc-bead"}>
                            <circle className="njc-bead-dot" cx={b.x} cy={b.y} r={beadR.toFixed(2)} />
                            <text className="njc-bead-num" x={b.x} y={b.y} fontSize={b.size.toFixed(2)}>
                              {b.label}
                            </text>
                          </g>
                        ))}
                      </g>
                    ) : null}
                  </svg>
                  <div className="njc-center">
                    <svg className="njc-lotus" viewBox="0 0 64 36" aria-hidden="true">
                      <g id="njcMark">
                        <circle cx="32" cy="18" r="5.2" />
                        <path d="M32 3v6M32 27v6M17 18h6M41 18h6M21.4 7.4l4.2 4.2M38.4 24.4l4.2 4.2M21.4 28.6l4.2-4.2M38.4 11.6l4.2-4.2" />
                      </g>
                    </svg>
                    <span ref={digitsRef} className="njc-digits" id="njcDigits" style={{ ["--digits" as string]: String(Math.max(1, display.length)) }}>
                      {display}
                    </span>
                    <span className="njc-tlabel tabular">{targetLine}</span>
                    {roundLine ? <span className="njc-rlabel tabular">{roundLine}</span> : null}
                    {timerLine ? <span className="njc-timerline tabular">{timerLine}</span> : null}
                    <div className="njc-phrase">
                      <span className="njc-divider" aria-hidden="true">
                        <i />
                        <svg viewBox="0 0 64 36">
                          <use href="#njcMark" />
                        </svg>
                        <i />
                      </span>
                      <div className="big dev" lang="ar">
                        {arabic}
                      </div>
                      <div className="sub">{dhikr?.arabic ? translit : meaning}</div>
                      <div className="mean">{dhikr?.arabic ? meaning : ""}</div>
                    </div>
                  </div>
                  <div ref={fxRef} className="njc-fx" aria-hidden="true" />
                </div>
                <span className="njc-fstap" aria-hidden="true">
                  <i />
                  <span>{rite ? "Tap for each lap" : "Tap to count"}</span>
                </span>
              </button>

              <div className="njc-ctlrail">
                <button type="button" className="njc-ctl" onClick={toggleFs}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                    <path
                      d={fs ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"}
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="lb">
                    <span className="lg">{fs ? "Exit" : "Full screen"}</span>
                    <span className="sm">{fs ? "Exit" : "Full"}</span>
                  </span>
                </button>
                <button type="button" className="njc-ctl" onClick={undo} disabled={s.undoStack.length === 0}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                    <path d="M9 14L4 9l5-5M4 9h9a6 6 0 010 12h-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="lb">
                    <span className="lg">Undo</span>
                    <span className="sm">Undo</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="njc-ctl primary"
                  aria-disabled={!canTarget}
                  onClick={() => (canTarget ? openSheet("target") : openSheet("dhikr"))}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                    <path d="M12 4a8 8 0 100 16 8 8 0 000-16zm0 5a3 3 0 100 6 3 3 0 000-6z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="lb">
                    <span className="lg">{targetLg}</span>
                    <span className="sm">{targetSm}</span>
                  </span>
                </button>
                <button type="button" className="njc-ctl quiet" onClick={() => openSheet("reset")}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                    <path d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006 5.3M4 15a8 8 0 0014 3.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="lb">
                    <span className="lg">Reset</span>
                    <span className="sm">Reset</span>
                  </span>
                </button>
                <button type="button" className="njc-ctl" onClick={() => openSheet("more")}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h.01M12 12h.01M19 12h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                  </svg>
                  <span className="lb">
                    <span className="lg">More</span>
                    <span className="sm">More</span>
                  </span>
                </button>
              </div>

              <div className="njc-chiprow njc-modes" role="group" aria-label="Counting mode">
                <button type="button" className="njc-chip njc-mode" aria-pressed={mode === "up"} onClick={() => setMode("up")}>
                  Count up
                </button>
                <button
                  type="button"
                  className="njc-chip njc-mode"
                  aria-pressed={mode === "down"}
                  disabled={!allows(s.state.mode, "countdown")}
                  onClick={() => setMode("down")}
                >
                  Countdown
                </button>
                <button type="button" className="njc-chip njc-mode" aria-pressed={mode === "timer"} disabled={rite} onClick={() => setMode("timer")}>
                  {timerLine ? `Timer ${timerLine}` : "Timer"}
                </button>
                <button type="button" className="njc-chip njc-mode" aria-pressed={mode === "auto"} disabled={rite} onClick={() => setMode("auto")}>
                  Auto
                </button>
                {canVibrate ? (
                  <button type="button" className="njc-chip njc-mode" aria-pressed={st.vibration} onClick={() => st.toggle("vibration")}>
                    Haptic
                  </button>
                ) : null}
              </div>
            </div>

            {/* ============ RIGHT RAIL ============ */}
            <div className="njc-rail right">
              <div className="njc-panel">
                <div className="njc-ptitle">Your practice</div>
                <div className="njc-kv">
                  <div>
                    <b data-stat="today" data-long={statLong(todayTxt)}>{todayTxt}</b>
                    <span>Today</span>
                  </div>
                  <div>
                    <b data-long={statLong(roundsTxt)}>{roundsTxt}</b>
                    <span>Rounds</span>
                  </div>
                  <div>
                    <b>{streakNow > 0 ? fmt(streakNow) : "—"}</b>
                    <span>Streak</span>
                  </div>
                  <div>
                    <b data-long={statLong(lifeTxt)}>{lifeTxt}</b>
                    <span>Lifetime</span>
                  </div>
                </div>
                <div className="njc-ptitle" style={{ margin: "16px 0 6px" }}>
                  Last 7 days
                </div>
                <div className="njc-chart">
                  {practice.week.map((w, i) => (
                    <div key={i} className={`njc-cc${w.now ? " today" : ""}`}>
                      <em>{w.c ? fmt(w.c) : ""}</em>
                      <div className="njc-cb" style={{ height: `${Math.max((w.c / practice.max) * 100, 3)}%` }} />
                      <small>{w.label}</small>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}>
                  <div className="njc-row">
                    <span className="k">Best day</span>
                    <span className="v tabular">{fmt(practice.best)}</span>
                  </div>
                  <div className="njc-row">
                    <span className="k">Active days</span>
                    <span className="v tabular">{fmt(practice.keys.length)}</span>
                  </div>
                  <div className="njc-row">
                    <span className="k">Time counting</span>
                    <span className="v tabular">{hm(practice.time)}</span>
                  </div>
                  <div className="njc-row">
                    <span className="k">Pace</span>
                    <span className="v tabular">{practice.pace ? `${fmt(practice.pace)} /min` : "—"}</span>
                  </div>
                </div>
              </div>

              <div className="njc-panel">
                <div className="njc-ptitle">History</div>
                <div className="njc-scroll" id="njcHist" tabIndex={0} role="region" aria-label="History">
                  {histShown.length ? (
                    histShown.map((k) => {
                      const [y, m, d] = k.split("-").map(Number);
                      const h = hist[k];
                      return (
                        <div key={k} className="njc-row">
                          <span className="k">
                            {new Date(y, m - 1, d).toLocaleDateString(st.locale || "en", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          <span className="v tabular">
                            {fmt(h.c)}
                            {h.r ? ` · ${fmt(h.r)}×` : ""}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <p style={{ fontSize: "12.5px", color: "var(--fg-subtle)", textAlign: "center", padding: "10px 0" }}>Nothing recorded yet.</p>
                  )}
                </div>
                {histMore ? (
                  <button type="button" className="njc-btn block njc-histmore" aria-expanded={histOpen} onClick={() => setHistOpen((o) => !o)}>
                    {histOpen ? "Show less" : "View all"}
                  </button>
                ) : null}
              </div>

              <div className="njc-panel" id="njcLibPanel2">
                <div className="njc-ptitle">Library</div>
                <LibList list={libList} favs={favs} current={curId} onPick={(id) => void s.selectDhikr(id)} onFav={toggleFav} />
                <button type="button" className="njc-btn block" style={{ marginTop: 12 }} onClick={() => openSheet("dhikr")}>
                  All dhikr
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ============ SHEETS ============ */}
        <div
          className={`njc-scrim${sheet !== "none" && sheet !== "dhikr" ? " open" : ""}`}
          onClick={closeSheet}
          aria-hidden="true"
        />

        <div className={`njc-sheet${sheet === "target" ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Target">
          <div className="njc-grab" />
          <div className="njc-shead">
            <h3>Set a target</h3>
            <button type="button" className="njc-close" data-close="" aria-label="Close" onClick={closeSheet}>
              ✕
            </button>
          </div>
          <div className="njc-sbody">
            <div className="njc-tgrid">
              {targetOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="njc-tbtn tabular"
                  aria-pressed={s.state.target === t}
                  onClick={() => {
                    const kind = dhikr?.targets.find((x) => x.value === t)?.kind ?? "user-goal";
                    s.setTarget(t, kind);
                  }}
                >
                  {fmt(t)}
                </button>
              ))}
            </div>
            <div className="njc-field">
              <input
                className="njc-input tabular"
                type="number"
                min={1}
                max={MAX_TARGET}
                inputMode="numeric"
                placeholder="Custom target"
                aria-label="Custom target"
                aria-invalid={!!targetErr}
                value={targetIn}
                onChange={(e) => setTargetIn(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setCustomTarget();
                }}
              />
              <button type="button" className="njc-btn primary" onClick={setCustomTarget}>
                Set
              </button>
            </div>
            {targetErr ? (
              <p className="njc-fieldmsg" role="alert">
                {targetErr}
              </p>
            ) : null}
            {canRounds ? (
              <>
                <div className="njc-ptitle" style={{ margin: "20px 0 6px" }}>
                  Rounds
                </div>
                <p className="njc-rsub">Split the count into rounds of this size. Off counts straight through.</p>
                <div className="njc-tgrid">
                  {ROUND_SIZES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="njc-tbtn tabular"
                      aria-pressed={(s.state.roundSize || 0) === r}
                      onClick={() => s.setRounds(r || null)}
                    >
                      {r ? fmt(r) : "Off"}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <button
              type="button"
              className="njc-btn block"
              style={{ marginTop: 14 }}
              onClick={() => {
                s.setTarget(null);
                s.setRounds(null);
                closeSheet();
              }}
            >
              No target, count freely
            </button>
          </div>
        </div>

        <div className={`njc-sheet${sheet === "reset" ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Reset">
          <div className="njc-grab" />
          <div className="njc-shead">
            <h3>Reset</h3>
            <button type="button" className="njc-close" data-close="" aria-label="Close" onClick={closeSheet}>
              ✕
            </button>
          </div>
          <div className="njc-sbody">
            <button
              type="button"
              className="njc-opt"
              onClick={() => {
                undo();
                closeSheet();
              }}
            >
              <span className="l">
                <b>Undo last count</b>
                <span>Steps back by one. Nothing else changes.</span>
              </span>
            </button>
            <button
              type="button"
              className="njc-opt"
              onClick={() => {
                s.resetCurrent();
                closeSheet();
              }}
            >
              <span className="l">
                <b>Reset the counter</b>
                <span>Back to zero. Today and your history are kept.</span>
              </span>
            </button>
            <button
              type="button"
              className="njc-opt"
              onClick={() => {
                if (s.state.routine) s.restart();
                else s.finishSession(false);
                closeSheet();
              }}
            >
              <span className="l">
                <b>{s.state.routine ? "Restart the routine" : "Finish the session"}</b>
                <span>{s.state.routine ? "Back to the first step. What you counted is kept." : "Banks the count and starts fresh at zero."}</span>
              </span>
            </button>
            <button
              type="button"
              className="njc-opt"
              data-armed={armed === "today" ? "" : undefined}
              onClick={() => {
                if (Ledger.refuses("today")) return closeSheet();
                if (armed !== "today") return setArmed("today");
                setArmed(null);
                const r = Ledger.clearToday();
                if (r.ok) s.resetCurrent();
                closeSheet();
              }}
            >
              <span className="l">
                <b>{armed === "today" ? "Tap again to clear today" : "Clear today"}</b>
                <span>Removes today&rsquo;s count from your record.</span>
              </span>
            </button>
            <button
              type="button"
              className="njc-btn danger block"
              style={{ marginTop: 16 }}
              data-armed={armed === "all" ? "" : undefined}
              onClick={async () => {
                if (Ledger.refuses("all")) return closeSheet();
                if (armed !== "all") return setArmed("all");
                setArmed(null);
                const r = Ledger.eraseAll();
                closeSheet();
                if (!r.ok) return;
                await clearDeviceData();
                location.reload();
              }}
            >
              {armed === "all" ? "Tap again to erase everything" : "Erase everything"}
            </button>
            <p style={{ marginTop: 10, fontSize: 11, color: "var(--fg-subtle)", textAlign: "center" }}>These change only this device.</p>
          </div>
        </div>

        <div className={`njc-sheet${sheet === "more" ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Settings">
          <div className="njc-grab" />
          <div className="njc-shead">
            <h3>Settings</h3>
            <button type="button" className="njc-close" data-close="" aria-label="Close" onClick={closeSheet}>
              ✕
            </button>
          </div>
          <div className="njc-sbody">
            <div className="njc-ptitle">Theme</div>
            <div className="njc-seg">
              {THEMES.map(([t, label]) => (
                <button key={t} type="button" className="njc-segb" aria-pressed={st.theme === t} onClick={() => st.setTheme(t)}>
                  {label}
                </button>
              ))}
            </div>

            <div className="njc-ptitle" style={{ margin: "18px 0 6px" }}>
              Numerals
            </div>
            <div className="njc-seg">
              <button type="button" className="njc-segb" aria-pressed={numerals === "latin"} onClick={() => st.set("numerals", "latin")}>
                123
              </button>
              <button type="button" className="njc-segb" aria-pressed={numerals === "arabic-indic"} onClick={() => st.set("numerals", "arabic-indic")}>
                ١٢٣
              </button>
            </div>

            <div className="njc-ptitle" style={{ margin: "18px 0 6px" }}>
              Language
            </div>
            <div className="njc-seg">
              <button type="button" className="njc-segb" aria-pressed={st.localeAuto} onClick={() => st.setLanguage("auto")}>
                Automatic
              </button>
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className="njc-segb"
                  lang={l.code}
                  aria-pressed={!st.localeAuto && st.locale === l.code}
                  onClick={() => st.setLanguage(l.code)}
                >
                  {l.native}
                </button>
              ))}
            </div>
            <p className="njc-rsub" style={{ marginTop: 8 }}>
              Sets how numbers and dates are written. The Arabic of every dhikr is always shown as it is.
            </p>

            <div className="njc-ptitle" style={{ margin: "20px 0 2px" }}>
              While counting
            </div>
            {canVibrate ? (
              <Switch label="Haptic" hint="A short pulse on every count." on={st.vibration} onToggle={() => st.toggle("vibration")} />
            ) : null}
            <Switch label="Sound" hint="A quiet tick on each count." on={st.sound} onToggle={() => st.toggle("sound")} />
            <Switch label="Dhikr bubbles" hint="The dhikr rises from the ring as you count." on={prefs.bubbles} onToggle={() => setPrefs({ bubbles: !prefs.bubbles })} />
            <Switch label="Bead ring" hint="Draw the tasbih beads around the ring." on={prefs.beads} onToggle={() => setPrefs({ beads: !prefs.beads })} />
            <Switch label="Keep the screen awake" hint="The screen stays on while you count." on={st.wakeLock} onToggle={() => st.toggle("wakeLock")} />

            <div className="njc-ptitle" style={{ margin: "20px 0 6px" }}>
              Auto count
            </div>
            <div className="njc-seg">
              {AUTO_SPEEDS.map((ms) => (
                <button
                  key={ms}
                  type="button"
                  className="njc-segb"
                  aria-pressed={prefs.autoMs === ms}
                  onClick={() => {
                    setPrefs({ autoMs: ms });
                    if (s.autoRunning) useCounter.setState((p) => ({ state: { ...p.state, autoIntervalMs: ms } }));
                  }}
                >
                  {(ms / 1000).toFixed(1)}s
                </button>
              ))}
            </div>

            <div className="njc-ptitle" style={{ margin: "20px 0 6px" }}>
              Timer length
            </div>
            <div className="njc-seg">
              {TIMER_LENGTHS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  className="njc-segb"
                  aria-pressed={prefs.timerSec === sec}
                  onClick={() => {
                    if (sec === prefs.timerSec) return;
                    setPrefs({ timerSec: sec });
                    if (s.state.timerSeconds !== null) s.startTimed(sec);
                  }}
                >
                  {sec / 60} min
                </button>
              ))}
            </div>

            <div className="njc-ptitle" style={{ margin: "20px 0 6px" }}>
              Your data
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button type="button" className="njc-btn" onClick={() => Ledger.exportBackup()}>
                Back up
              </button>
              <button
                type="button"
                className="njc-btn"
                onClick={() => {
                  fileRef.current?.click();
                }}
              >
                Restore
              </button>
            </div>
            <input
              ref={fileRef}
              id="njcFile"
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) {
                  Ledger.importBackup(f);
                  closeSheet();
                }
              }}
            />
            <p style={{ marginTop: 10, fontSize: 11, color: "var(--fg-subtle)" }}>
              {ledger.signedIn
                ? "Saved in this browser and synced to your account."
                : "Saved automatically in this browser. With Premium it is also synced to your account."}
            </p>
          </div>
        </div>

        {/* ============ MILESTONES ============ */}
        {mile && (mile.kind === "target" || mile.kind === "routine") ? (
          <div className="njc-mile" role="status">
            <p className="t">{mile.kind === "routine" ? "Routine complete" : mile.label === "Time complete" ? "Time complete" : "Target reached"} ✓</p>
            <p className="s">
              {mile.kind === "routine"
                ? "Every step is counted and saved. Start again, or finish here."
                : "Your count is saved. Continue this round, or Finish to bank it and start again at zero."}
            </p>
            <div className="acts">
              <button type="button" onClick={() => s.clearMilestone()}>
                Continue
              </button>
              <button type="button" className="primary" onClick={() => s.finishSession(false)}>
                Finish
              </button>
            </div>
          </div>
        ) : mile ? (
          <div className="njc-pill" role="status">
            {mile.label} ✓
          </div>
        ) : null}
      </div>

      {/* The dhikr picker is the Tasbih Counts one, unchanged. */}
      <div className="tc njc-dhikr">
        <DhikrSheet open={sheet === "dhikr"} onClose={closeSheet} />
      </div>
    </>
  );
}

function LibList({
  list,
  favs,
  current,
  onPick,
  onFav,
}: {
  list: { id: string; name: string; arabic: string; meaning: string }[];
  favs: string[];
  current: string;
  onPick: (id: string) => void;
  onFav: (id: string) => void;
}) {
  return (
    <div className="njc-lib njc-scroll">
      {list.map((x) => {
        const faved = favs.includes(x.id);
        return (
          <div key={x.id} className="njc-librow">
            <button
              type="button"
              className={`njc-star${faved ? " on" : ""}`}
              aria-pressed={faved}
              aria-label={`Favourite: ${x.name}`}
              onClick={() => onFav(x.id)}
            >
              ★
            </button>
            <button type="button" className="njc-libitem" aria-current={x.id === current} onClick={() => onPick(x.id)}>
              <span className="n">
                <b>{x.name}</b>
                <span>{x.meaning}</span>
              </span>
              <span className="a" lang="ar">
                {x.arabic}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Switch({ label, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="njc-opt" role="switch" aria-checked={on} onClick={onToggle}>
      <span className="l">
        <b>{label}</b>
        <span>{hint}</span>
      </span>
      <span className="njc-sw" aria-hidden="true" />
    </button>
  );
}
