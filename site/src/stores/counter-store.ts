"use client";

/**
 * The counter store. One engine, every mode.
 * Specification sections 1, 11, 12, 17, 18, 22, 23, 24, 24B, 24C, 29, 30,
 * 88, 89, 90, 133.
 *
 * Rules enforced here:
 *   - a tap updates memory and renders immediately, never waits on storage
 *   - IndexedDB is written on a throttle and flushed on lifecycle events
 *   - switching dhikr preserves the previous count as a snapshot
 *   - only sealed sessions are ever persisted for upload
 */

import { create } from "zustand";
import type {
  CounterEvent,
} from "@/core/counter";
import {
  allows,
  createCounter,
  increment,
  pushUndo,
  UNDO_DEPTH,
  resetCount,
  resetRoutineStep,
  restartRoutine,
  setRounds as applyRounds,
  setStartingCount as applyStart,
  setTarget as applyTarget,
  undo as applyUndo,
  view,
} from "@/core/counter";
import type {
  CounterState,
  DailyTotal,
  Dhikr,
  SealReason,
  Session,
  StreakInfo,
  UndoEntry,
} from "@/core/types";
import { toLocalDate } from "@/core/dates";
import { rollUp } from "@/core/streak";
import { weekWindow } from "@/core/dates";
import * as Ledger from "@/lib/counter/ledger";
import { qualifies } from "@/lib/counter/streak";
import {
  AUTO_MAX_UNATTENDED_MS,
  markAutoCounted,
  crossedMidnight,
  deviceId,
  isDiscardable,
  openSession,
  rebaseSession,
  sealSession,
  shouldSealForIdle,
  touchSession,
} from "@/core/session";
import {
  canOfferPace,
  createLearner,
  learnedIntervalMs,
  recordTap,
  resetLearner,
  type PaceLearner,
  type Speed,
} from "@/core/autocount";
import {
  allSessions,
  createFlusher,
  deleteSession,
  getSnapshot,
  putSession,
  putSnapshot,
  putCustomDhikr,
  deleteCustomDhikr,
  clearSnapshot,
  allCustomDhikr,
  requestPersistentStorage,
  readLocal,
  writeLocal,
} from "@/lib/storage";
import { feedback, ticker } from "@/lib/feedback";
import { broadcast, subscribe, withLock } from "@/lib/tabs";
import { applyLibrary, DEFAULT_DHIKR_ID, getDhikr } from "@/content/dhikr";
import { getRoutine, routineTargets } from "@/content/routines";
import { normaliseRiteState } from "@/core/rites";
import { useSequences } from "@/stores/sequences-store";
import { useSettings } from "./settings-store";

const flusher = createFlusher(1200);

/**
 * The in-flight hydration, if there is one.
 *
 * `hydrate()` used to guard only on the COMPLETED flag, which is not the same
 * thing. React StrictMode invokes an effect twice in development, and both
 * calls saw `hydrated === false` because neither had finished — so two full
 * hydrations ran concurrently, and whichever finished last overwrote the other
 * with a stale snapshot.
 *
 * Found by testing: a landing page that starts a guided routine had the routine
 * silently replaced by the restored snapshot, so /dhikr-33-33-34-counter opened
 * on plain SubhanAllah instead of the routine it names.
 *
 * The same race is reachable in production whenever two components mount in the
 * same tick, so this is not a StrictMode workaround — StrictMode just found it.
 */
let hydration: Promise<void> | null = null;

export interface Milestone {
  id: number;
  kind: "round" | "target" | "step" | "routine";
  label: string;
}

interface CounterStore {
  hydrated: boolean;
  state: CounterState;
  undoStack: UndoEntry[];
  session: Session | null;
  lastTapAt: number;
  /**
   * The last time a PERSON did something — a tap, a key, a control. Auto-count
   * moves lastTapAt but never this, which is what makes the idle rule and the
   * auto stop honest.
   */
  lastHumanAt: number;
  totals: Map<string, DailyTotal>;
  today: number;
  lifetime: number;
  streak: StreakInfo;
  milestone: Milestone | null;
  /** Text for the polite live region (section 71.1). */
  announcement: string;
  learner: PaceLearner;
  autoRunning: boolean;
  autoSpeed: Speed;
  customDhikr: Dhikr[];

  hydrate: () => Promise<void>;
  /** `auto` marks a tick produced by auto-count rather than by a person. */
  tap: (auto?: boolean) => void;
  undo: () => void;
  resetCurrent: () => void;
  resetStep: () => void;
  restart: () => void;
  selectDhikr: (id: string) => Promise<void>;
  startRoutine: (routineId: string) => Promise<void>;
  exitRoutine: () => Promise<void>;
  setTarget: (target: number | null, kind?: CounterState["targetKind"]) => void;
  setRounds: (size: number | null) => void;
  setStep: (n: number) => void;
  setStartingCount: (n: number) => void;
  startTimed: (seconds: number) => void;
  stopTimed: () => void;
  tickTimer: () => void;
  startAuto: () => void;
  stopAuto: () => void;
  setAutoSpeed: (s: Speed) => void;
  clearMilestone: () => void;
  /** Section 134: seal the session and return the ring to zero. */
  finishSession: (startAgain: boolean) => void;
  addCustomDhikr: (d: Dhikr) => void;
  updateCustomDhikr: (id: string, patch: Partial<Dhikr>) => Promise<void>;
  removeCustomDhikr: (id: string) => Promise<void>;
  /** Remove one sealed session and rebuild every total from what remains. */
  deleteSessionRecord: (id: string) => Promise<void>;
  /** Seal the open session and fold it into the totals. */
  flush: (reason?: SealReason) => Promise<void>;
  /** Persist the open session without sealing it (section 12.2). */
  persist: () => Promise<void>;
  /** Section 12.2 rule 4: thirty minutes with no tap ends the session. */
  sealIfIdle: () => Promise<void>;
  recomputeStats: () => void;
}

const emptyStreak: StreakInfo = { current: 0, longest: 0, week: [] };

/* ---------- the practice ledger (lib/counter/ledger.ts) ----------
 *
 * Every tap is also reported to the ledger, which keeps the record the Stats and
 * Streak pages read and syncs it to the account. What it was told for each tap is
 * kept here, one entry per undo entry, so an undo can take back exactly that.
 */
type Credit = { id: string; c: number; r: number };
let credits: Credit[] = [];

function dropCredits(): UndoEntry[] {
  credits = [];
  return [];
}

/**
 * How much one increment is worth to the ledger: the counts it added, and how many
 * rounds it completed. A round is what the streak is made of — a completed target,
 * a completed round or routine step, and with no target at all, every 33.
 */
function creditFor(prev: CounterState, next: CounterState, events: CounterEvent[]): Credit {
  const c =
    prev.routine && next.routine
      ? next.routine.totalCount - prev.routine.totalCount
      : next.count - prev.count;
  // In a routine the counter's own dhikrId stays on the first step; the count
  // belongs to the step being recited.
  const id =
    (prev.routine && getRoutine(prev.routine.routineId)?.steps[prev.routine.stepIndex]?.dhikrId) ||
    prev.dhikrId;
  if (c <= 0) return { id, c: 0, r: 0 };
  let r = events.filter(
    (e) => e.type === "round-complete" || e.type === "target-complete" || e.type === "step-complete",
  ).length;
  if (!r && !prev.routine && prev.mode !== "rite" && !next.target && !next.roundSize) {
    r =
      Math.floor(next.count / Ledger.ROUND_FALLBACK) -
      Math.floor(prev.count / Ledger.ROUND_FALLBACK);
  }
  return { id, c, r: Math.max(0, r) };
}

/* ---------- live region throttle (section 71.1) ----------
 *
 * A polite live region that receives twenty updates a second does not read
 * twenty numbers; it reads the first and then stutters. Rate limit to one
 * message per 1500ms, and always publish the LATEST value at the end of a
 * burst so the number a screen reader announces is the number on screen.
 */
const ANNOUNCE_MS = 1500;
let announceAt = 0;
let announceTimer: ReturnType<typeof setTimeout> | null = null;
let announcePending: string | null = null;

type Setter = (partial: Partial<CounterStore>) => void;

function announce(
  set: Setter,
  get: () => CounterStore,
  text: string,
  immediate = false,
): void {
  const now = Date.now();
  if (announceTimer) {
    clearTimeout(announceTimer);
    announceTimer = null;
  }

  if (immediate || now - announceAt >= ANNOUNCE_MS) {
    announceAt = now;
    announcePending = null;
    set({ announcement: text });
    return;
  }

  announcePending = text;
  announceTimer = setTimeout(
    () => {
      announceTimer = null;
      announceAt = Date.now();
      if (announcePending !== null) set({ announcement: announcePending });
      announcePending = null;
      void get;
    },
    ANNOUNCE_MS - (now - announceAt),
  );
}

function labelFor(e: CounterEvent): string | null {
  switch (e.type) {
    case "round-complete":
      return `Round ${e.round} complete`;
    case "target-complete":
      return `${e.target} complete`;
    case "routine-complete":
      return "Routine complete";
    default:
      return null;
  }
}

/**
 * Cross-tab wiring, registered once at module scope.
 *
 * A second tab used to overwrite the first: both hydrated, both held their own
 * counter, and whichever flushed last won. Now a tab that changes sessions says
 * so, and every other tab re-reads its totals instead of writing over them.
 *
 * The COUNTER itself is deliberately not mirrored live between tabs. Two people
 * counting on two tabs of one browser is not a real scenario, and streaming
 * every tap between tabs would cost a message per tap for no benefit. What is
 * protected is the durable record: sessions, totals and the library.
 */
let tabWiringDone = false;

function wireTabs(get: () => CounterStore, set: Setter): void {
  if (tabWiringDone || typeof window === "undefined") return;
  tabWiringDone = true;

  subscribe((message) => {
    if (message.type === "sessions-changed" || message.type === "library-changed") {
      // Re-read from storage rather than trusting anything in this tab.
      void (async () => {
        const sessions = (await allSessions()).filter((x) => x.status === "sealed");
        set({ totals: rollUp(sessions) });
        get().recomputeStats();
        if (message.type === "library-changed") {
          set({ customDhikr: await allCustomDhikr() });
        }
      })();
    }
  });
}

export const useCounter = create<CounterStore>((set, get) => ({
  hydrated: false,
  state: createCounter(DEFAULT_DHIKR_ID),
  undoStack: [],
  session: null,
  lastTapAt: 0,
  lastHumanAt: 0,
  totals: new Map(),
  today: 0,
  lifetime: 0,
  streak: emptyStreak,
  milestone: null,
  announcement: "",
  learner: createLearner(),
  autoRunning: false,
  autoSpeed: 1,
  customDhikr: [],

  async hydrate() {
    if (get().hydrated) return;
    // A second caller joins the first rather than starting its own.
    if (hydration) return hydration;

    wireTabs(get, set);

    const run = async (): Promise<void> => {
      // Ask the browser not to evict this data. Safari deletes everything after
      // seven idle days without it, and a guest has no cloud copy to restore
      // from. Never awaited for its answer before counting starts.
      void requestPersistentStorage();
      // The admin panel's library, inlined by the page (content/dhikr.ts).
      applyLibrary();


    // The user's own sequences must reach the routine engine BEFORE a restored
    // snapshot can name one of them, or resuming a custom routine would look
    // up an id the engine has never heard of.
    await useSequences.getState().hydrate();

    const lastId = readLocal<string>("lastDhikr", DEFAULT_DHIKR_ID);
    const dhikr = getDhikr(lastId) ?? getDhikr(DEFAULT_DHIKR_ID);
    const snap = await getSnapshot(lastId);

    const base = createCounter(dhikr?.id ?? DEFAULT_DHIKR_ID, {
      target: dhikr?.defaultTarget ?? null,
      targetKind:
        dhikr?.targets.find((t) => t.value === dhikr.defaultTarget)?.kind ??
        "user-goal",
    });

    // A rite restored from a snapshot must come back as a rite, not as a
    // tasbih that happens to have a target of seven.
    const state: CounterState = normaliseRiteState(
      snap
        ? {
            ...base,
            count: snap.count,
            target: snap.target,
            targetKind: snap.targetKind,
            roundSize: snap.roundSize,
            roundNumber: snap.roundNumber,
            step: snap.step || 1,
          }
        : base,
    );

    /* A session marked "open" in storage belongs to a page life that has
     * already ended — the tab was closed, or the browser discarded it. Nothing
     * will ever seal it again, and an unsealed session is invisible to every
     * statistic, so Today and the streak would silently reset on every reload.
     * Seal them here, once, before anything is rolled up. */
    const stored = await allSessions();
    const stale = stored.filter((x) => x.status === "open");
    const repaired: Session[] = [];
    for (const s of stale) {
      const sealed = sealSession(s, "page-hidden", s.updatedAt || Date.now());
      if (isDiscardable(sealed)) {
        await deleteSession(sealed.id);
      } else {
        await putSession(sealed);
        repaired.push(sealed);
      }
    }

    const sessions = [
      ...stored.filter((x) => x.status === "sealed"),
      ...repaired,
    ];
    const totals = rollUp(sessions);

      set({ hydrated: true, state, totals });
      get().recomputeStats();
    };

    hydration = run();
    try {
      await hydration;
    } finally {
      // Cleared either way: a failed hydration must be retryable rather than
      // leaving the store permanently stuck on a rejected promise.
      hydration = null;
    }
  },

  recomputeStats() {
    // The ledger is the one record: the numbers here are the ones the Stats and
    // Streak pages show, and they include other devices once the account syncs.
    const locale = useSettings.getState().locale || "en";
    const v = Ledger.getView();
    const today = toLocalDate();
    set({
      today: v.today,
      lifetime: v.lifetime,
      streak: {
        current: v.streak.current,
        longest: v.streak.best,
        week: weekWindow(locale, today).map((w) => ({ ...w, done: qualifies(v.hist[w.localDate]) })),
      },
    });
  },

  tap(auto = false) {
    const s = get();
    const now = Date.now();

    // Auto-count stops itself once nobody has touched anything for a while.
    // Otherwise the wake lock plus a face-down phone is a number generator.
    if (auto && s.lastHumanAt && now - s.lastHumanAt >= AUTO_MAX_UNATTENDED_MS) {
      get().stopAuto();
      announce(set, get, "Auto count stopped after thirty minutes", true);
      return;
    }

    // Section 15.3: absorb duplicate events without ever rejecting a real tap.
    if (now - s.lastTapAt < 40) return;

    let session = s.session;

    // Open a session on the first tap for this dhikr and routine pair.
    if (!session || session.status === "sealed") {
      session = openSession(s.state, deviceId(), now);
      // Auto was already running when this session opened, so it is auto too.
      if (s.autoRunning) session = markAutoCounted(session);
    } else if (crossedMidnight(session, now)) {
      // Section 12.2: split the record at midnight, never the visible count.
      const sealed = sealSession(session, "midnight-rollover", now);
      if (!isDiscardable(sealed)) void putSession(sealed);
      session = openSession(s.state, deviceId(), now);
      // The new half of a split session inherits how it is being counted.
      if (s.autoRunning || sealed.autoCounted) session = markAutoCounted(session);
    }

    const targets = s.state.routine
      ? routineTargets(getRoutine(s.state.routine.routineId)!)
      : undefined;

    const { state, undo, events } = increment(s.state, targets);
    // A rite already walked, or a count at its ceiling: nothing happened.
    if (state === s.state) return;

    const credit = creditFor(s.state, state, events);
    Ledger.record(credit.id, credit.c, credit.r);
    credits.push(credit);
    if (credits.length > UNDO_DEPTH) credits.shift();

    // Feedback first, so it feels instant.
    const { sound, vibration } = useSettings.getState();
    const hasMilestone = events.some((e) => e.type !== "count");
    feedback(hasMilestone ? "target" : "tap", { sound, vibration });

    // Starts empty, so counting on is itself the answer to the completion card
    // and it never sits over the ring while the user is still tapping.
    let milestone: Milestone | null = null;
    let announcement = "";

    for (const e of events) {
      const label = labelFor(e);
      if (label) milestone = { id: now, kind: e.type.split("-")[0] as Milestone["kind"], label };
    }

    const v = view(state, useSettings.getState().countdown);
    const dhikrName = getDhikr(state.dhikrId)?.name ?? "Dhikr";
    announcement = v.target
      ? `${v.display} of ${v.target}, ${dhikrName}`
      : `${v.display}, ${dhikrName}`;

    const learner = recordTap(s.learner, now);

    set({
      state,
      session: touchSession(session, state, now),
      undoStack: pushUndo(s.undoStack, undo),
      lastTapAt: now,
      ...(auto ? {} : { lastHumanAt: now }),
      milestone,
      learner,
    });

    // Section 71.1: at most one announcement per 1500ms during rapid counting,
    // always carrying the latest value. A milestone jumps the queue, because a
    // completed round is worth interrupting for.
    announce(set, get, announcement, hasMilestone);

    get().recomputeStats();

    // Section 90: throttled, never per tap.
    flusher.schedule(async () => {
      const cur = get();
      if (cur.session) await putSession(cur.session);
      await putSnapshot(cur.state);
    });
  },

  undo() {
    const s = get();
    const entry = s.undoStack[s.undoStack.length - 1];
    if (!entry) return;
    const credit = credits[credits.length - 1];
    if (credit && !Ledger.unrecord(credit.id, credit.c, credit.r)) {
      // Already saved to the account: lowering it here would come straight back.
      announce(set, get, "Those counts are already saved to your account", true);
      return;
    }
    credits.pop();
    const state = applyUndo(s.state, entry);
    set({
      state,
      undoStack: s.undoStack.slice(0, -1),
      session: s.session ? touchSession(s.session, state) : null,
      announcement: `Undone. ${view(state, useSettings.getState().countdown).display}`,
    });
    get().recomputeStats();
    flusher.schedule(async () => {
      const cur = get();
      if (cur.session) await putSession(cur.session);
      await putSnapshot(cur.state);
    });
  },

  resetCurrent() {
    const s = get();
    // Section 12.2 rule 6: Reset seals the session. It clears the number on
    // screen, never the day. flush() captures the session synchronously, so
    // the set() below cannot race it away.
    void get().flush("reset");
    const state = resetCount(s.state);
    set({
      state,
      undoStack: dropCredits(),
      session: null,
      milestone: null,
      announcement: "Counter reset to zero",
    });
    void putSnapshot(state);
    get().recomputeStats();
  },

  resetStep() {
    const state = resetRoutineStep(get().state);
    set({ state, undoStack: dropCredits(), announcement: "Current step reset" });
    void putSnapshot(state);
  },

  restart() {
    void get().flush("reset");
    const state = restartRoutine(get().state);
    set({ state, undoStack: dropCredits(), session: null, announcement: "Routine restarted" });
    void putSnapshot(state);
    get().recomputeStats();
  },

  async selectDhikr(id) {
    const s = get();
    if (id === s.state.dhikrId && !s.state.routine) return;

    // Section 12.2: switching dhikr seals the session.
    await get().flush("dhikr-switch");
    // Section 133: the outgoing count is kept, not destroyed.
    await putSnapshot(s.state);

    const dhikr = getDhikr(id) ?? s.customDhikr.find((d) => d.id === id);
    const snap = await getSnapshot(id);

    const restored: CounterState = snap
      ? {
          ...createCounter(id),
          count: snap.count,
          target: snap.target,
          targetKind: snap.targetKind,
          roundSize: snap.roundSize,
          roundNumber: snap.roundNumber,
          step: snap.step || 1,
        }
      : createCounter(id, {
          target: dhikr?.defaultTarget ?? null,
          targetKind:
            dhikr?.targets.find((t) => t.value === dhikr.defaultTarget)?.kind ??
            "user-goal",
          roundSize: dhikr?.roundSize ?? null,
        });

    // Sections 51 and 52: a rite is the same counter in a different mode, and
    // every entry point has to land in it. A no-op for everything else.
    const state = normaliseRiteState(restored);

    writeLocal("lastDhikr", id);
    const recents = readLocal<string[]>("recentDhikr", []);
    writeLocal("recentDhikr", [id, ...recents.filter((r) => r !== id)].slice(0, 8));

    set({
      state,
      undoStack: dropCredits(),
      session: null,
      milestone: null,
      learner: resetLearner(),
      autoRunning: false,
      announcement: `${dhikr?.name ?? "Dhikr"} selected`,
    });
    get().recomputeStats();
  },

  async startRoutine(routineId) {
    const routine = getRoutine(routineId);
    if (!routine) return;
    await get().flush("dhikr-switch");

    const first = routine.steps[0];
    if (!first) return;

    const state = createCounter(first.dhikrId, {
      mode: "routine",
      target: first.target,
      targetKind: "source-backed",
      routine: {
        routineId,
        stepIndex: 0,
        stepCount: 0,
        totalCount: 0,
        completedSteps: [],
        status: "active",
      },
    });

    set({
      state,
      undoStack: dropCredits(),
      session: null,
      milestone: null,
      announcement: `${routine.title} started`,
    });
    get().recomputeStats();
  },

  async exitRoutine() {
    await get().flush("dhikr-switch");
    await get().selectDhikr(readLocal<string>("lastDhikr", DEFAULT_DHIKR_ID));
  },

  setTarget(target, kind = "user-goal") {
    if (!allows(get().state.mode, "target")) return;
    const state = applyTarget(get().state, target, kind);
    set({ state, announcement: target ? `Target set to ${target}` : "Target cleared" });
    void putSnapshot(state);
  },

  setRounds(size) {
    if (!allows(get().state.mode, "rounds")) return;
    const state = applyRounds(get().state, size);
    set({ state });
    void putSnapshot(state);
  },

  setStep(n) {
    const step = n === 1 || n === 3 || n === 10 ? n : 1;
    const state = { ...get().state, step };
    set({ state, announcement: `Counting by ${step}` });
    void putSnapshot(state);
  },

  setStartingCount(n) {
    const s = get();
    const state = applyStart(s.state, n);
    set({
      state,
      undoStack: dropCredits(),
      // A jump to a starting number is not counting, so the open session's
      // baseline moves with it and the day's total does not inflate.
      session: s.session ? rebaseSession(s.session, state) : null,
      announcement: `Starting from ${state.count}`,
    });
    void putSnapshot(state);
    get().recomputeStats();
  },

  startTimed(seconds) {
    // A rite is seven laps walked; a countdown timer means nothing over it, and
    // switching the mode away from "rite" would unlock the target picker and an
    // eighth round. Refuse rather than corrupt.
    if (get().state.mode === "rite") return;
    set({ state: { ...get().state, mode: "timed", timerSeconds: seconds } });
    announce(set, get, "Timer started", true);
  },

  /** A timer the user cannot cancel is a trap, not a mode (section 24). */
  stopTimed() {
    const s = get().state;
    if (s.timerSeconds === null) return;
    set({ state: { ...s, timerSeconds: null, mode: "manual" } });
    announce(set, get, "Timer stopped", true);
  },

  tickTimer() {
    const s = get().state;
    if (s.timerSeconds === null) return;
    const next = s.timerSeconds - 1;
    if (next <= 0) {
      const { sound, vibration } = useSettings.getState();
      feedback("complete", { sound, vibration });
      set({
        state: { ...s, timerSeconds: null, mode: "manual" },
        milestone: { id: Date.now(), kind: "target", label: "Time complete" },
        announcement: "Time complete",
      });
      return;
    }
    set({ state: { ...s, timerSeconds: next } });
  },

  startAuto() {
    const s = get();
    // Auto-count taps for you. On a rite each tap is a whole lap, so auto-count
    // would walk a Tawaf on its own and complete it while the phone sits on a
    // table — the exact opposite of a rite the person actually performed.
    if (s.state.mode === "rite") return;
    const base = learnedIntervalMs(s.learner);
    if (!base || !canOfferPace(s.learner)) return;
    ticker.unlock();
    const interval = Math.round(base / s.autoSpeed);

    // From here on this session is auto-counted, permanently. It stays in the
    // user own history and is excluded from the leaderboard, because the
    // counter advanced rather than the person reciting.
    const session = s.session ? markAutoCounted(s.session) : null;
    if (session) void putSession(session);

    set({
      autoRunning: true,
      session,
      lastHumanAt: Date.now(),
      state: { ...s.state, autoIntervalMs: interval },
      announcement: "Auto count started",
    });
  },

  stopAuto() {
    set({
      autoRunning: false,
      state: { ...get().state, autoIntervalMs: null },
      announcement: "Auto count stopped",
    });
  },

  setAutoSpeed(speed) {
    const s = get();
    const base = learnedIntervalMs(s.learner);
    set({
      autoSpeed: speed,
      state: {
        ...s.state,
        autoIntervalMs: base ? Math.round(base / speed) : s.state.autoIntervalMs,
      },
    });
  },

  clearMilestone() {
    set({ milestone: null });
  },

  /**
   * Section 134: reaching a target offers a choice, and none of the choices
   * destroys the count. Both of these bank the session first — the number goes
   * to Today and the streak — and only then return the ring to zero with the
   * same target still set.
   */
  finishSession(startAgain) {
    const s = get();
    const banked = s.session?.count ?? 0;
    const reason: SealReason = s.state.routine ? "routine-complete" : "target-finished";
    void get().flush(reason);
    // A completed routine begins again from step one; a plain counter returns
    // to zero with the same target. Either way the finished work is banked.
    const state = s.state.routine ? restartRoutine(s.state) : resetCount(s.state);
    set({
      state,
      undoStack: dropCredits(),
      milestone: null,
    });
    void putSnapshot(state);
    get().recomputeStats();
    announce(
      set,
      get,
      startAgain
        ? s.state.routine
          ? "Routine restarted"
          : "New round started"
        : `Session saved. ${banked} counted.`,
      true,
    );
  },

  addCustomDhikr(d) {
    Ledger.rememberCustom({ id: d.id, n: d.arabic, t: d.name, m: d.meaning });
    set({ customDhikr: [...get().customDhikr, d] });
  },

  /**
   * Gap 12: a custom dhikr could be created and then never touched again. A
   * typo in your own Arabic was permanent, which is an absurd thing to say
   * about a field the user typed themselves.
   */
  async updateCustomDhikr(id, patch) {
    const existing = get().customDhikr.find((d) => d.id === id);
    if (!existing) return;
    const next: Dhikr = { ...existing, ...patch, id: existing.id, custom: true };
    await putCustomDhikr(next);
    Ledger.rememberCustom({ id: next.id, n: next.arabic, t: next.name, m: next.meaning });
    set({ customDhikr: get().customDhikr.map((d) => (d.id === id ? next : d)) });
    broadcast({ type: "library-changed" });
  },

  /**
   * Deleting a custom dhikr removes the entry, NOT the counting. Sessions that
   * referenced it stay exactly as they are, so the day's total and the streak
   * do not move — the history shows the id it was counted under, because
   * pretending the practice never happened would be the worse lie.
   */
  async removeCustomDhikr(id) {
    await deleteCustomDhikr(id);
    await clearSnapshot(id);
    const remaining = get().customDhikr.filter((d) => d.id !== id);
    set({ customDhikr: remaining });
    broadcast({ type: "library-changed" });

    // Counting cannot continue against something that no longer exists.
    if (get().state.dhikrId === id) {
      await get().selectDhikr(DEFAULT_DHIKR_ID);
    }
  },

  /**
   * Gap 11: two hundred taps by accident used to be permanent. History was
   * read-only, so a pocket-tap or a child with the phone silently became part
   * of a streak for ever.
   *
   * This deletes ONE sealed session and rebuilds the totals from what is left.
   * It is deliberately a delete rather than an edit: a session is a record of
   * something that happened, and a half-corrected record is harder to trust
   * than an absent one. The confirmation names the count and the dhikr so
   * nobody removes the wrong sitting.
   *
   * A session already uploaded is removed locally and its cloud row is left in
   * place; `sync_sessions` is monotonic by design (13.1) and will not accept a
   * lower count, so the cloud copy is corrected from the account screen rather
   * than by a silent downward write from here.
   */
  async deleteSessionRecord(id) {
    // Sealing and deleting both rebuild the roll-ups, and two tabs doing that
    // at once is the one place interleaving would corrupt rather than lose.
    await withLock("rollup", async () => {
      await deleteSession(id);
      const totals = rollUp(
        (await allSessions()).filter((x) => x.status === "sealed"),
      );
      set({ totals });
      get().recomputeStats();
    });
    broadcast({ type: "sessions-changed" });
  },

  async persist() {
    await flusher.flush();
    const s = get();
    if (!s.session) return;
    // Section 12.2: backgrounding a tab for a moment must NOT seal. Write the
    // session as it stands so nothing is lost if the page never comes back;
    // hydrate() seals whatever is still open next time.
    await putSession(touchSession(s.session, s.state));
    await putSnapshot(s.state);
  },

  async sealIfIdle() {
    const s = get();
    // Measured from the last HUMAN action, so an auto session still goes idle.
    if (!s.session || !shouldSealForIdle(s.session, s.lastHumanAt || s.lastTapAt)) return;
    await get().flush("idle-timeout");
  },

  async flush(reason = "dhikr-switch") {
    /* The session is captured BEFORE any await. Reset and Restart call this and
     * then clear the session synchronously; reading get().session after the
     * first await found null and silently discarded the whole session, which is
     * how a Reset used to erase the day's total. */
    const s = get();
    const open = s.session;
    set({ session: null });

    await flusher.flush();
    if (!open) return;

    const sealed = sealSession(touchSession(open, s.state), reason);
    if (isDiscardable(sealed)) {
      await deleteSession(sealed.id);
      return;
    }

    await putSession(sealed);
    const totals = rollUp(
      (await allSessions()).filter((x) => x.status === "sealed"),
    );
    set({ totals });
    get().recomputeStats();
    broadcast({ type: "sessions-changed" });
  },
}));
