/**
 * Session lifecycle.
 * Specification section 12.2, the definition without which Today, streak,
 * deduplication and cloud statistics are all undefined.
 */

import type {
  CounterState,
  SealReason,
  Session,
  SessionStatus,
} from "./types";
import { toLocalDate, tzOffsetMinutes, endOfLocalDay } from "./dates";

/** Section 12.2: thirty minutes with no tap seals the session. */
export const IDLE_SEAL_MS = 30 * 60 * 1000;

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for engines without crypto.randomUUID. It must still be a valid
  // UUID: the session id is a uuid column server-side, and an id that fails to
  // cast would drop the session silently at sync time.
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[8 + Math.floor(Math.random() * 4)];
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

/** The counter value a session measures from. Routines count their own total. */
export function absoluteCount(state: CounterState): number {
  return state.routine && state.mode === "routine"
    ? state.routine.totalCount
    : state.count;
}

export function openSession(
  state: CounterState,
  deviceId: string,
  now = Date.now(),
): Session {
  const d = new Date(now);
  return {
    id: newId(),
    deviceId,
    userId: null,
    dhikrId: state.dhikrId,
    routineId: state.routine?.routineId ?? null,
    routineStep: state.routine?.stepIndex ?? null,
    count: 0,
    // A counter resumed from a snapshot starts here, so the session only ever
    // claims the counts it actually saw.
    baseCount: absoluteCount(state),
    target: state.target,
    roundSize: state.roundSize,
    roundNumber: state.roundNumber,
    mode: state.mode,
    startedAt: now,
    endedAt: null,
    localDate: toLocalDate(d),
    tzOffsetMin: tzOffsetMinutes(d),
    status: "open",
    autoCounted: false,
    syncedUserId: null,
    updatedAt: now,
    createdAt: now,
  };
}

export function touchSession(
  session: Session,
  state: CounterState,
  now = Date.now(),
): Session {
  // Never the absolute value: the session owns the difference it produced.
  const count = Math.max(0, absoluteCount(state) - session.baseCount);

  return {
    ...session,
    count,
    target: state.target,
    roundSize: state.roundSize,
    roundNumber: state.roundNumber,
    routineStep: state.routine?.stepIndex ?? null,
    updatedAt: now,
  };
}

/**
 * The counter jumped for a reason that is not counting — "start from a number"
 * is the only one. Move the baseline with it so the jump is not banked as
 * practice the user never performed.
 */
export function rebaseSession(session: Session, state: CounterState): Session {
  return { ...session, baseCount: absoluteCount(state) - session.count };
}

/**
 * Mark the session as having been advanced by auto-count. Once set it never
 * clears: a session that ran on a timer for an hour and then took two manual
 * taps is still an auto session, and pretending otherwise would launder it.
 */
export function markAutoCounted(session: Session): Session {
  return session.autoCounted ? session : { ...session, autoCounted: true };
}

export function sealSession(
  session: Session,
  reason: SealReason,
  now = Date.now(),
): Session {
  // Midnight rollover ends the record at 23:59:59.999 of its own local day so
  // the count lands in the day it was actually performed.
  const endedAt =
    reason === "midnight-rollover" ? endOfLocalDay(session.localDate) : now;

  return {
    ...session,
    endedAt,
    status: "sealed" as SessionStatus,
    updatedAt: now,
  };
}

/** Section 12.2: a session that seals with zero is discarded, never stored. */
export function isDiscardable(session: Session): boolean {
  return session.count <= 0;
}

/**
 * Section 12.2 rule 4, corrected.
 *
 * This used to take the time of the LAST TAP, and auto-count taps for you — so
 * a session in auto mode never went idle and never sealed. A phone left running
 * overnight kept one session open until the browser died, and everything in it
 * landed on whichever day it was finally sealed.
 *
 * The clock that matters is the last time a PERSON did something.
 */
export function shouldSealForIdle(
  session: Session,
  lastHumanActionAt: number,
  now = Date.now(),
): boolean {
  return session.status === "open" && now - lastHumanActionAt >= IDLE_SEAL_MS;
}

/**
 * Auto-count stops on its own after this long with no human interaction.
 *
 * Without a stop it is an unbounded number generator: wake lock on, phone face
 * down, and the count rises all night. Thirty minutes is longer than any real
 * hands-free sitting and short enough that a forgotten tab cannot manufacture a
 * lifetime total.
 */
export const AUTO_MAX_UNATTENDED_MS = 30 * 60 * 1000;

export function crossedMidnight(session: Session, now = Date.now()): boolean {
  return session.status === "open" && session.localDate !== toLocalDate(new Date(now));
}

/**
 * Section 12.4: only a sealed session may ever be uploaded. This removes the
 * whole class of partially synced growing session bugs.
 */
export function isUploadable(session: Session): boolean {
  return session.status === "sealed" && session.count > 0;
}

export function deviceId(): string {
  if (typeof localStorage === "undefined") return "server";
  const KEY = "tc.deviceId";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = newId();
    localStorage.setItem(KEY, id);
  }
  return id;
}
