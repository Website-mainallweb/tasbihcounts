/**
 * Custom guided sequences.
 * Specification section 4, premium feature 2, and section 40 for the engine.
 *
 * A sequence is just a Routine the user wrote, so the ONE routine engine runs
 * it unchanged (section 1). Nothing here is public: a custom sequence is
 * private for ever (section 60), and it carries no review status of its own
 * because the user is not publishing religious content — they are arranging
 * their own practice.
 *
 * Pure. Validation lives here so the UI and the store cannot disagree.
 */

import type { Routine, RoutineStep } from "./types";

export const MAX_STEPS = 50;
export const MAX_NAME = 60;
export const MAX_TARGET = 9_999_999;

export interface Sequence {
  id: string;
  name: string;
  steps: RoutineStep[];
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export function emptySequence(id: string, now = Date.now()): Sequence {
  return {
    id,
    name: "",
    steps: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

export function makeStep(id: string, dhikrId: string, target: number): RoutineStep {
  return { id, dhikrId, target: clampTarget(target) };
}

export function clampTarget(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_TARGET, Math.max(1, Math.round(n)));
}

export function moveStep(steps: RoutineStep[], from: number, to: number): RoutineStep[] {
  if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) {
    return steps;
  }
  const next = [...steps];
  const [item] = next.splice(from, 1);
  if (item) next.splice(to, 0, item);
  return next;
}

export function totalOf(seq: Sequence): number {
  return seq.steps.reduce((n, s) => n + s.target, 0);
}

export type SequenceError = "name" | "steps" | "too-many-steps";

export function validate(seq: Sequence): SequenceError | null {
  if (seq.name.trim().length === 0) return "name";
  if (seq.steps.length === 0) return "steps";
  if (seq.steps.length > MAX_STEPS) return "too-many-steps";
  return null;
}

export const ERROR_TEXT: Record<SequenceError, string> = {
  name: "Give your sequence a name.",
  steps: "Add at least one step.",
  "too-many-steps": `A sequence can hold up to ${MAX_STEPS} steps.`,
};

/** The shape the routine engine consumes. */
export function toRoutine(seq: Sequence): Routine {
  return {
    id: seq.id,
    title: seq.name.trim() || "My sequence",
    description: "Your own sequence, saved on this device.",
    steps: seq.steps,
    category: "routines",
    aliases: [],
    sources: [],
    // A user's own arrangement is not published religious content, so the
    // review gate of section 61 does not apply to it. It is never shown to
    // anyone else.
    reviewStatus: "approved",
    custom: true,
  };
}

export function duplicate(seq: Sequence, id: string, now = Date.now()): Sequence {
  return {
    ...seq,
    id,
    name: `${seq.name} copy`.slice(0, MAX_NAME),
    steps: seq.steps.map((s, i) => ({ ...s, id: `${id}-s${i}` })),
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}
