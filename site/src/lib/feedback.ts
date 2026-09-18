/**
 * Sound, vibration and wake lock. All feature detected, none required.
 * Specification sections 26, 27, 28, and the research revision to 27.
 *
 * Why vibration matters more than it looks: a review of a one-million-install
 * counter said the haptic is "strong enough to feel that click is made, u can
 * feel it even when ur eyes are closed". For a large group of users the haptic
 * IS the feedback channel, because they are not looking at the screen.
 *
 * Honest limitation: Safari on iOS has no Vibration API. On iPhone this channel
 * does not exist for a web app, so sound is offered as the substitute there.
 */

/* ---------- capability detection ---------- */

export function hasVibration(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function hasWakeLock(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export function isTouchPrimary(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && "ontouchend" in document);
}

/* ---------- vibration ---------- */

type Haptic = "tap" | "round" | "target" | "step" | "complete";

const PATTERNS: Record<Haptic, number | number[]> = {
  tap: 12,
  step: [18, 40, 18],
  round: [22, 50, 22],
  target: [26, 60, 26, 60, 26],
  complete: [30, 70, 30, 70, 40],
};

export function vibrate(kind: Haptic, enabled: boolean): void {
  if (!enabled || !hasVibration()) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* some browsers throw when the page is not visible */
  }
}

/* ---------- sound ---------- */

/**
 * A tiny synthesised tick. Section 26 forbids a remote audio service, and a
 * generated tone avoids shipping an audio file at all.
 */
/**
 * The available ticks (gap 12).
 *
 * One synthesised tone was the whole sound design, and a person counting for
 * forty minutes hears it several thousand times — so "I do not like the sound"
 * meant "I count in silence". Each of these is generated, not a file: section 26
 * forbids a remote audio service, and shipping four audio files for a tool that
 * must work offline is weight nobody asked for.
 *
 * They differ in waveform and decay rather than only in pitch, because at 35ms
 * pitch alone is close to indistinguishable.
 */
export type TickSound = "tick" | "wood" | "bell" | "drop" | "none";

export const TICK_SOUNDS: { value: TickSound; label: string; hint: string }[] = [
  { value: "tick", label: "Tick", hint: "A short, dry click" },
  { value: "wood", label: "Wood", hint: "Softer, like a wooden bead" },
  { value: "bell", label: "Bell", hint: "A small bright chime" },
  { value: "drop", label: "Drop", hint: "Low and round" },
  { value: "none", label: "Silent", hint: "Haptic only" },
];

interface Voice {
  type: OscillatorType;
  /** Multiplier on the base frequency for this event kind. */
  freq: number;
  /** Seconds. */
  dur: number;
  peak: number;
}

const VOICES: Record<Exclude<TickSound, "none">, Voice> = {
  tick: { type: "sine", freq: 880, dur: 0.035, peak: 0.05 },
  wood: { type: "triangle", freq: 420, dur: 0.055, peak: 0.06 },
  bell: { type: "sine", freq: 1320, dur: 0.22, peak: 0.045 },
  drop: { type: "sine", freq: 300, dur: 0.09, peak: 0.07 },
};

class Ticker {
  private ctx: AudioContext | null = null;
  private ready = false;
  private sound: TickSound = "tick";
  /** 0 to 1. A counter at full volume for forty minutes is a lot of counter. */
  private volume = 0.7;

  setSound(sound: TickSound): void {
    this.sound = sound;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
  }

  /** Must be called from a real user gesture the first time. */
  unlock(): void {
    if (this.ready) return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      void this.ctx.resume();
      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  play(kind: Haptic, enabled: boolean): void {
    if (!enabled) return;
    if (!this.ready) this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;

    try {
      if (ctx.state === "suspended") void ctx.resume();

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (this.sound === "none") return;
      const voice = VOICES[this.sound] ?? VOICES.tick;

      // A milestone is the same voice, lifted and lengthened, so the family is
      // recognisable rather than four unrelated noises.
      const lift =
        kind === "tap" ? 1 : kind === "step" ? 0.75 : kind === "round" ? 0.84 : 1.12;
      const freq = voice.freq * lift;
      const dur = kind === "tap" ? voice.dur : Math.max(voice.dur, 0.12);
      const peak = (kind === "tap" ? voice.peak : voice.peak * 1.8) * this.volume;
      if (peak <= 0) return;

      osc.type = voice.type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch {
      /* audio is never required for counting */
    }
  }
}

export const ticker = new Ticker();

/** One call for both channels, so callers never forget one. */
export function feedback(
  kind: Haptic,
  opts: { sound: boolean; vibration: boolean },
): void {
  vibrate(kind, opts.vibration);
  ticker.play(kind, opts.sound);
}

/* ---------- wake lock (section 28) ---------- */

let sentinel: WakeLockSentinel | null = null;

export async function requestWakeLock(enabled: boolean): Promise<boolean> {
  if (!enabled || !hasWakeLock()) return false;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
    return true;
  } catch {
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await sentinel?.release();
  } catch {
    /* ignore */
  }
  sentinel = null;
}

export function wakeLockActive(): boolean {
  return sentinel !== null;
}
