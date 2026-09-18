/**
 * Domain types for Tasbih Counts.
 * Specification sections 12, 20, 22, 40, 61, 89.
 * No React, no browser APIs, no side effects in this folder.
 */

/* ---------- religious content review state (section 61) ---------- */

export type ReviewStatus = "draft" | "needs-review" | "approved" | "disputed";

export type SourceType = "quran" | "hadith" | "scholarly" | "user-goal" | "none";

export interface SourceRef {
  /** Human readable citation, e.g. "Sahih Muslim 597". */
  label: string;
  /** Optional public URL for the reader to verify. */
  url?: string;
  type: SourceType;
}

/** Section 20: every target is one of exactly two kinds. */
export type TargetKind = "source-backed" | "user-goal";

export interface TargetOption {
  value: number;
  kind: TargetKind;
  /** Shown only for source-backed targets. */
  note?: string;
}

/* ---------- dhikr ---------- */

export type DhikrCategory =
  | "popular"
  | "after-salah"
  | "tasbih"
  | "istighfar"
  | "tahlil"
  | "durood"
  | "asma"
  | "routines"
  | "morning-evening"
  | "wazifa"
  | "hajj"
  | "recitation"
  | "mine";

export interface Dhikr {
  id: string;
  /** Latin display name, e.g. "SubhanAllah". */
  name: string;
  /** Original Arabic. Never machine translated (section 63). */
  arabic: string;
  transliteration: string;
  /** Plain English meaning. Separate field from the Arabic by rule. */
  meaning: string;
  category: DhikrCategory;
  /** Search aliases across spellings and scripts (sections 32 and 136.1). */
  aliases: string[];
  targets: TargetOption[];
  defaultTarget?: number;
  roundSize?: number;
  sources: SourceRef[];
  reviewStatus: ReviewStatus;
  /** True for user-created entries, which are always private (section 60). */
  custom?: boolean;
  createdAt?: number;
}

/* ---------- guided routines (section 40) ---------- */

export interface RoutineStep {
  id: string;
  dhikrId: string;
  /** Overrides the dhikr default for this step. */
  target: number;
  title?: string;
  note?: string;
}

export interface Routine {
  id: string;
  title: string;
  description: string;
  steps: RoutineStep[];
  category: DhikrCategory;
  aliases: string[];
  sources: SourceRef[];
  reviewStatus: ReviewStatus;
  /** Shown when scholarly opinion differs (section 56). */
  disputedNote?: string;
  custom?: boolean;
}

export type RoutineStatus = "idle" | "active" | "paused" | "completed";

/** Section 89: the routine behaves as an explicit state machine. */
export interface RoutineState {
  routineId: string;
  stepIndex: number;
  stepCount: number;
  totalCount: number;
  completedSteps: number[];
  status: RoutineStatus;
}

/* ---------- counter (sections 22, 23, 24, 24B) ---------- */

export type CounterMode =
  | "manual"
  | "countdown"
  | "timed"
  | "auto"
  | "routine"
  | "asma"
  /** Tawaf and Sa'i: seven laps, fixed, with no target or rounds (section 51). */
  | "rite";

export interface CounterState {
  dhikrId: string;
  count: number;
  target: number | null;
  targetKind: TargetKind;
  roundSize: number | null;
  roundNumber: number;
  mode: CounterMode;
  routine: RoutineState | null;
  /** 1, 3 or 10. Observed on tasbih.org, added by research. */
  step: number;
  /** Section 24: seconds remaining, null when not in timed mode. */
  timerSeconds: number | null;
  /** Section 24C: milliseconds between automatic counts. */
  autoIntervalMs: number | null;
}

/** One reversible increment (section 17.1). */
export interface UndoEntry {
  count: number;
  roundNumber: number;
  stepIndex: number;
  stepCount: number;
  totalCount: number;
  at: number;
}

/* ---------- sessions (section 12) ---------- */

export type SessionStatus = "open" | "sealed";

export interface Session {
  id: string;
  deviceId: string;
  userId: string | null;
  dhikrId: string;
  routineId: string | null;
  routineStep: number | null;
  /**
   * Counts performed INSIDE this session, never the counter's absolute value.
   * The distinction matters: a counter restored from a snapshot at 40 opens its
   * next session at 40, and a session that reported 41 after one tap would add
   * forty phantom counts to the day.
   */
  count: number;
  /**
   * The absolute counter value when the session opened. `count` is derived from
   * it, so undo, rounds and routine steps all stay honest.
   */
  baseCount: number;
  target: number | null;
  roundSize: number | null;
  roundNumber: number;
  mode: CounterMode;
  startedAt: number;
  endedAt: number | null;
  /** Device local calendar day, YYYY-MM-DD. The grouping key for every stat. */
  localDate: string;
  tzOffsetMin: number;
  status: SessionStatus;
  /**
   * True when any part of this session was produced by auto-count rather than
   * by a person tapping. The counter advanced; the user did not necessarily
   * recite. Kept in the users own history, excluded from the leaderboard.
   */
  autoCounted: boolean;
  syncedUserId: string | null;
  /**
   * Section 13.2: when a second account signs in on the same device, a session
   * already synced under the first is re-keyed before it can be uploaded. The
   * old id is kept here so the local record is still auditable.
   */
  localPreviousId?: string;
  updatedAt: number;
  createdAt: number;
}

export type SealReason =
  | "target-finished"
  | "routine-complete"
  | "dhikr-switch"
  | "idle-timeout"
  | "midnight-rollover"
  | "reset"
  | "page-hidden";

/* ---------- statistics ---------- */

export interface DailyTotal {
  localDate: string;
  count: number;
  sessions: number;
  byDhikr: Record<string, number>;
}

export interface StreakInfo {
  current: number;
  longest: number;
  /** Seven entries, oldest first, aligned to the locale week start. */
  week: { localDate: string; label: string; done: boolean; isToday: boolean }[];
}

/* ---------- settings (section 130) ---------- */

export type ThemeChoice = "system" | "light" | "dark" | "noor" | "heritage";
export type NumeralStyle = "latin" | "arabic-indic";

/**
 * How the counter is drawn (gap 11).
 *
 * "ring" is the bead ring that is also the brand mark. "beads" draws a strung
 * misbaha instead — a line of beads with the marker travelling along it —
 * because a large number of people want the thing they already hold, and
 * telling them the abstraction is better is not an argument that wins.
 *
 * Both are the same SVG geometry driven by the same progress value; neither is
 * a separate counter.
 */
export type CounterSkin = "ring" | "beads";

export interface Settings {
  theme: ThemeChoice;
  sound: boolean;
  vibration: boolean;
  wakeLock: boolean;
  countdown: boolean;
  numerals: NumeralStyle;
  /** Which counter face is drawn. */
  skin: CounterSkin;
  /** Which synthesised tick plays. */
  tickSound: string;
  /** 0 to 1. */
  volume: number;
  defaultTarget: number | null;
  locale: string;
  /**
   * When true the language follows the device (navigator.language) on every
   * load, so a user who never touches the setting always gets their own
   * language automatically. Choosing a language explicitly turns this off.
   */
  localeAuto: boolean;
  /** Section 94: shown only after real engagement. */
  installPromptSeen: boolean;
  reducedGlow: boolean;
}

export interface EntitlementCache {
  plan: "free" | "lifetime_plus";
  validatedAt: number | null;
  graceUntil: number | null;
}
