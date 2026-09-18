/**
 * The universal counter engine.
 * Specification sections 1, 17, 18, 22, 23, 88, 89.
 *
 * Pure functions only. No React, no storage, no DOM. Every rule that decides
 * what a count means lives here so it can be unit tested and so exactly one
 * implementation serves every preset, route and mode (section 1).
 */

import type { CounterState, RoutineState, UndoEntry } from "./types";
import { clamp, MAX_TARGET } from "./format";
import { RITE_LAPS } from "./rites";

export const UNDO_DEPTH = 50; // section 17.1

export interface IncrementResult {
  state: CounterState;
  undo: UndoEntry;
  events: CounterEvent[];
}

export type CounterEvent =
  | { type: "count"; value: number }
  | { type: "round-complete"; round: number }
  | { type: "target-complete"; target: number }
  | { type: "step-complete"; stepIndex: number }
  | { type: "routine-complete" };

/* ---------- creation ---------- */

export function createCounter(
  dhikrId: string,
  overrides: Partial<CounterState> = {},
): CounterState {
  return {
    dhikrId,
    count: 0,
    target: null,
    targetKind: "user-goal",
    roundSize: null,
    roundNumber: 1,
    mode: "manual",
    routine: null,
    step: 1,
    timerSeconds: null,
    autoIntervalMs: null,
    ...overrides,
  };
}

/* ---------- increment ---------- */

/**
 * One count. Returns the next state, an undo entry and the events the UI should
 * react to. The caller decides what a milestone sounds or feels like; this
 * function only decides that one happened.
 */
export function increment(
  state: CounterState,
  routineTargets?: number[],
): IncrementResult {
  const undo: UndoEntry = {
    count: state.count,
    roundNumber: state.roundNumber,
    stepIndex: state.routine?.stepIndex ?? 0,
    stepCount: state.routine?.stepCount ?? 0,
    totalCount: state.routine?.totalCount ?? 0,
    at: Date.now(),
  };

  const events: CounterEvent[] = [];
  const stepSize = state.step > 0 ? state.step : 1;
  const next: CounterState = { ...state };

  /* --- guided routine (section 41) --- */
  if (next.routine && routineTargets?.length) {
    const r = next.routine;
    const stepTarget = routineTargets[r.stepIndex] ?? 0;
    const stepCount = r.stepCount + stepSize;
    const totalCount = r.totalCount + stepSize;

    if (stepTarget > 0 && stepCount >= stepTarget) {
      events.push({ type: "step-complete", stepIndex: r.stepIndex });
      const isLast = r.stepIndex >= routineTargets.length - 1;

      const nextRoutine: RoutineState = isLast
        ? {
            ...r,
            stepCount: stepTarget,
            totalCount,
            completedSteps: [...r.completedSteps, r.stepIndex],
            status: "completed",
          }
        : {
            ...r,
            stepIndex: r.stepIndex + 1,
            stepCount: 0,
            totalCount,
            completedSteps: [...r.completedSteps, r.stepIndex],
            status: "active",
          };

      if (isLast) events.push({ type: "routine-complete" });

      next.routine = nextRoutine;
      next.count = isLast ? stepTarget : 0;
      next.target = isLast ? stepTarget : (routineTargets[r.stepIndex + 1] ?? null);
      return { state: next, undo, events };
    }

    next.routine = { ...r, stepCount, totalCount, status: "active" };
    next.count = stepCount;
    next.target = stepTarget || null;
    events.push({ type: "count", value: stepCount });
    return { state: next, undo, events };
  }

  /* --- a rite: seven laps, and there is no eighth (section 51) --- */
  if (next.mode === "rite") {
    const laps = next.target ?? RITE_LAPS;
    if (state.count >= laps) {
      // Already finished. Return the state untouched and emit nothing, so a
      // stray press cannot record an eighth round, cannot fire the completion
      // moment a second time, and cannot push a no-op onto the undo stack.
      return { state, undo, events };
    }

    // A rite advances one lap at a time whatever the step setting says: "three
    // at a time" is a tasbih convenience and means nothing here.
    next.count = state.count + 1;
    events.push({ type: "count", value: next.count });
    if (next.count >= laps) {
      events.push({ type: "target-complete", target: laps });
    }
    return { state: next, undo, events };
  }

  /* --- plain counting --- */
  next.count = clamp(state.count + stepSize, 0, MAX_TARGET);
  events.push({ type: "count", value: next.count });

  // Rounds are independent of the total goal (section 22).
  if (next.roundSize && next.roundSize > 0) {
    const completedRounds = Math.floor(next.count / next.roundSize);
    const nextRound = completedRounds + 1;
    if (nextRound > next.roundNumber) {
      next.roundNumber = nextRound;
      events.push({ type: "round-complete", round: completedRounds });
    }
  }

  if (
    next.target &&
    state.count < next.target &&
    next.count >= next.target
  ) {
    events.push({ type: "target-complete", target: next.target });
  }

  return { state: next, undo, events };
}

/* ---------- undo (section 17) ---------- */

/**
 * Undo may cross a routine step, a round and a completed target, and must
 * restore the exact prior state in each case. It may never cross a session.
 */
export function undo(state: CounterState, entry: UndoEntry): CounterState {
  const next: CounterState = {
    ...state,
    count: entry.count,
    roundNumber: entry.roundNumber,
  };

  if (state.routine) {
    next.routine = {
      ...state.routine,
      stepIndex: entry.stepIndex,
      stepCount: entry.stepCount,
      totalCount: entry.totalCount,
      completedSteps: state.routine.completedSteps.filter(
        (i) => i < entry.stepIndex,
      ),
      status: "active",
    };
  }

  return next;
}

export function pushUndo(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  const next = [...stack, entry];
  return next.length > UNDO_DEPTH ? next.slice(next.length - UNDO_DEPTH) : next;
}

/* ---------- reset (section 18) ---------- */

export function resetCount(state: CounterState): CounterState {
  return { ...state, count: 0, roundNumber: 1 };
}

export function resetRoutineStep(state: CounterState): CounterState {
  if (!state.routine) return resetCount(state);
  return {
    ...state,
    count: 0,
    routine: {
      ...state.routine,
      stepCount: 0,
      totalCount: Math.max(0, state.routine.totalCount - state.routine.stepCount),
    },
  };
}

export function restartRoutine(state: CounterState): CounterState {
  if (!state.routine) return resetCount(state);
  return {
    ...state,
    count: 0,
    roundNumber: 1,
    routine: {
      ...state.routine,
      stepIndex: 0,
      stepCount: 0,
      totalCount: 0,
      completedSteps: [],
      status: "active",
    },
  };
}

/* ---------- targets and rounds ---------- */

export function setTarget(
  state: CounterState,
  target: number | null,
  kind: CounterState["targetKind"] = "user-goal",
): CounterState {
  return { ...state, target, targetKind: kind };
}

/**
 * Section 22: rounds never switch themselves on just because the target is
 * large. The user asks for them.
 */
export function setRounds(
  state: CounterState,
  roundSize: number | null,
): CounterState {
  if (!roundSize || roundSize <= 0) {
    return { ...state, roundSize: null, roundNumber: 1 };
  }
  return {
    ...state,
    roundSize,
    roundNumber: Math.floor(state.count / roundSize) + 1,
  };
}

/** Section 19.4, from a Play review: start from a number, not only from zero. */
export function setStartingCount(state: CounterState, value: number): CounterState {
  const count = clamp(Math.trunc(value), 0, MAX_TARGET);
  const roundNumber = state.roundSize
    ? Math.floor(count / state.roundSize) + 1
    : 1;
  return { ...state, count, roundNumber };
}

/* ---------- derived values ---------- */

export interface CounterView {
  /** What the big number shows. Countdown inverts it (section 23). */
  display: number;
  /** True count for statistics, never inverted. */
  actual: number;
  target: number | null;
  progress: number;
  roundNumber: number;
  roundSize: number | null;
  inRound: number;
  totalRounds: number | null;
  remaining: number | null;
  isComplete: boolean;
}

export function view(state: CounterState, countdown: boolean): CounterView {
  const actual = state.count;
  const target = state.target;
  const display = countdown && target ? Math.max(0, target - actual) : actual;

  const inRound = state.roundSize ? actual % state.roundSize : actual;
  const totalRounds =
    state.roundSize && target ? Math.ceil(target / state.roundSize) : null;

  return {
    display,
    actual,
    target,
    progress: target ? clamp((actual / target) * 100, 0, 100) : 0,
    roundNumber: state.roundNumber,
    roundSize: state.roundSize,
    inRound: state.roundSize && inRound === 0 && actual > 0 ? state.roundSize : inRound,
    totalRounds,
    remaining: target ? Math.max(0, target - actual) : null,
    isComplete: target ? actual >= target : false,
  };
}

/* ---------- mode matrix (section 24B) ---------- */

const MATRIX: Record<string, { target: boolean; rounds: boolean; countdown: boolean }> = {
  manual: { target: true, rounds: true, countdown: true },
  countdown: { target: true, rounds: true, countdown: true },
  timed: { target: true, rounds: true, countdown: true },
  auto: { target: true, rounds: true, countdown: true },
  routine: { target: false, rounds: false, countdown: false },
  asma: { target: false, rounds: false, countdown: false },
  // A rite is seven, fixed. Offering a target picker, rounds or a countdown
  // over it would be offering to change something that is not ours to change.
  rite: { target: false, rounds: false, countdown: false },
};

export function allows(
  mode: CounterState["mode"],
  feature: "target" | "rounds" | "countdown",
): boolean {
  return MATRIX[mode]?.[feature] ?? false;
}
