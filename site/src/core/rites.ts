/**
 * Hajj and Umrah rite trackers.
 * Specification sections 50, 51, 52, 53, and 114.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * Tawaf and Sa'i are each seven of something, tracked one at a time, with undo
 * and a confirmed reset. That is a counter with a target of seven — so this
 * module adds NO second engine, NO second session type and NO second storage
 * path. Section 114 is explicit that a specialised mode may have dedicated UI
 * but must share the common state, persistence, progress and history
 * infrastructure, and section 1 allows exactly one counting engine.
 *
 * So a rite is `CounterState` with `mode: "rite"` and `target: 7`. Every
 * guarantee the product already has — the throttled IndexedDB write, the
 * session with its immutable baseCount, the midnight split, multi-tab safety,
 * the undo stack — applies to a Tawaf without a line of new code. What lives
 * here is only the part that is genuinely different: how many laps, what one
 * lap is CALLED, and which way the walker is facing.
 *
 * WORDING
 *
 * Nothing here instructs anyone how to perform a rite. The product counts; it
 * does not teach. The only ritual wording present is the pair of place names
 * on the Sa'i, which the Master's own UX names, and the Talbiyah text, which
 * lives with the other religious content in `content/dhikr.ts` under the same
 * review gate. Section 63 forbids inventing or machine-translating any of it.
 *
 * ADVERTISING
 *
 * Section 51 forbids advertising inside an active Tawaf interface. That rule is
 * already unbreakable here rather than merely written down: `AdPlacement` in
 * `components/site/AdSlot.tsx` has no value for the counting area at all, so
 * there is no way to express an ad inside the tool, and a rite renders inside
 * the tool. `isRiteMode` below is the semantic boundary for anything later that
 * needs to ask the question directly.
 */

import type { CounterState } from "./types";

/** Both rites are seven. This is not a configurable number. */
export const RITE_LAPS = 7;

export type RiteId = "tawaf" | "sai";

export interface RiteDefinition {
  id: RiteId;
  /** Display name. */
  name: string;
  /** What one of the seven is called, singular and plural. */
  unit: string;
  unitPlural: string;
  /** The label on the single large action button. */
  action: string;
  /**
   * Sa'i runs between two points and alternates direction each length; Tawaf
   * does not, so this is absent for it rather than filled with a placeholder.
   */
  legs?: readonly [string, string];
}

export const RITES: Record<RiteId, RiteDefinition> = {
  tawaf: {
    id: "tawaf",
    name: "Tawaf",
    unit: "Round",
    unitPlural: "Rounds",
    action: "Complete round",
  },
  sai: {
    id: "sai",
    name: "Sa'i",
    unit: "Length",
    unitPlural: "Lengths",
    action: "Complete length",
    legs: ["Safa", "Marwah"],
  },
};

export const RITE_IDS = Object.keys(RITES) as RiteId[];

export function isRiteId(id: string): id is RiteId {
  return id === "tawaf" || id === "sai";
}

export function getRite(id: string): RiteDefinition | undefined {
  return isRiteId(id) ? RITES[id] : undefined;
}

/** True while the counter is tracking a rite, whatever the UI happens to show. */
export function isRiteMode(state: CounterState): boolean {
  return state.mode === "rite";
}

export interface RiteView {
  rite: RiteDefinition;
  /** Laps finished so far, 0 to RITE_LAPS. */
  completed: number;
  total: number;
  /** One entry per lap: true once that lap is finished. Drives the dot row. */
  laps: boolean[];
  isComplete: boolean;
  /**
   * Where the walker is going on the lap now in progress, e.g.
   * "Safa → Marwah". Null for Tawaf, which has no direction, and null once the
   * rite is complete, because there is no next length to describe.
   */
  direction: string | null;
}

/**
 * The whole presentation of a rite, derived from the count alone.
 *
 * Derived, never stored: a `direction` field kept alongside the count is a
 * second source of truth that undo has to remember to reverse, and the Phase 05
 * criterion "undo reverses trip count, displayed direction and completion
 * status" is then three things that can disagree. Computed from `completed`, it
 * is one thing, and undo cannot get it wrong.
 */
export function riteView(id: string, completed: number): RiteView | null {
  const rite = getRite(id);
  if (!rite) return null;

  const done = Math.max(0, Math.min(RITE_LAPS, Math.trunc(completed)));
  const isComplete = done >= RITE_LAPS;

  let direction: string | null = null;
  if (rite.legs && !isComplete) {
    // Length 1 goes Safa → Marwah, length 2 comes back, and so on. The lap in
    // progress is index `done`, so its parity decides the heading.
    const [a, b] = rite.legs;
    direction = done % 2 === 0 ? `${a} → ${b}` : `${b} → ${a}`;
  }

  return {
    rite,
    completed: done,
    total: RITE_LAPS,
    laps: Array.from({ length: RITE_LAPS }, (_, i) => i < done),
    isComplete,
    direction,
  };
}

/**
 * Force a counter for a rite into rite shape.
 *
 * Every path that can produce a `CounterState` runs through this: selecting a
 * rite from the sheet, a deep link, and — the one that is easy to forget —
 * hydrating a snapshot after a reload. A rite restored without it comes back as
 * an ordinary tasbih that happens to have a target of seven, which looks almost
 * right and behaves entirely wrong: the target picker unlocks, rounds unlock,
 * "three at a time" applies, and an eighth round becomes reachable.
 *
 * Seven is re-asserted rather than trusted, so a snapshot written by an older
 * build cannot carry a stale target in.
 */
export function normaliseRiteState(state: CounterState): CounterState {
  if (!isRiteId(state.dhikrId)) return state;
  return {
    ...state,
    mode: "rite",
    target: RITE_LAPS,
    targetKind: "source-backed",
    roundSize: null,
    roundNumber: 1,
    step: 1,
    routine: null,
    timerSeconds: null,
    autoIntervalMs: null,
    count: Math.max(0, Math.min(RITE_LAPS, Math.trunc(state.count))),
  };
}

/**
 * Whether one more lap may be recorded.
 *
 * Section 51: there is no eighth round. The engine enforces this too, so a
 * caller that forgets to ask cannot produce one; this exists so the button can
 * disable itself rather than silently doing nothing when pressed.
 */
export function canCompleteLap(state: CounterState): boolean {
  return isRiteMode(state) && state.count < RITE_LAPS;
}
