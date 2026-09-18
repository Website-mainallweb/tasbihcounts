"use client";

/**
 * Settings store.
 * Specification sections 27, 128, 130, and the research revision to 27.
 */

import { create } from "zustand";
import type { Settings, ThemeChoice } from "@/core/types";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from "@/lib/storage";
import { hasVibration, isTouchPrimary, ticker } from "@/lib/feedback";
import { broadcast, subscribe } from "@/lib/tabs";

interface SettingsStore extends Settings {
  hydrated: boolean;
  vibrationSupported: boolean;
  hydrate: () => void;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  toggle: (key: "sound" | "vibration" | "wakeLock" | "countdown" | "reducedGlow") => void;
  setTheme: (theme: ThemeChoice) => void;
  /** "auto" follows the device; any code pins that language (section 107). */
  setLanguage: (code: string | "auto") => void;
}

/** The two-letter language the device reports, defaulting to English. */
export function deviceLocale(): string {
  if (typeof navigator === "undefined") return "en";
  const base = (navigator.language || "en").split("-")[0]?.toLowerCase();
  return base && SUPPORTED_LOCALES.includes(base) ? base : "en";
}

/** Launch locales (spec section 106). Eastern-Arabic scripts read right-to-left. */
export const SUPPORTED_LOCALES = ["en", "ar", "ur", "id", "hi", "tr", "bn", "ms", "fr"];

/** Scripts whose readers expect Eastern-Arabic digits by default. */
const EASTERN_NUMERAL_LOCALES = ["ar", "ur"];

/** For the language picker: each launch locale in its own name. */
export const LANGUAGES: { code: string; native: string; english: string }[] = [
  { code: "en", native: "English", english: "English" },
  { code: "ar", native: "العربية", english: "Arabic" },
  { code: "ur", native: "اردو", english: "Urdu" },
  { code: "id", native: "Indonesia", english: "Indonesian" },
  { code: "hi", native: "हिन्दी", english: "Hindi" },
  { code: "tr", native: "Türkçe", english: "Turkish" },
  { code: "bn", native: "বাংলা", english: "Bengali" },
  { code: "ms", native: "Melayu", english: "Malay" },
  { code: "fr", native: "Français", english: "French" },
];

function applyTheme(theme: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  // Keep the browser chrome in step with the painted ground.
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
}

/**
 * Settings are the one thing genuinely worth mirroring live between tabs: two
 * tabs open, change the theme in one, and the other used to overwrite it on its
 * next save. Registered once at module scope.
 */
let settingsTabWiring = false;

function wireSettingsTabs(set: (partial: Partial<SettingsStore>) => void): void {
  if (settingsTabWiring || typeof window === "undefined") return;
  settingsTabWiring = true;
  subscribe((message) => {
    if (message.type !== "settings-changed") return;
    const stored = loadSettings();
    applyTheme(stored.theme);
    set(stored);
  });
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,
  vibrationSupported: false,

  hydrate() {
    if (get().hydrated) return;
    wireSettingsTabs(set);
    const stored = loadSettings();
    const supported = hasVibration();

    // Revised default: vibration ON for touch devices, OFF for pointer devices.
    // A first-time mobile user who feels nothing may conclude the tap did not
    // register. Only applied when the user has never chosen for themselves.
    const neverChosen = !("vibration" in (stored as object)) || stored.vibration === false;
    let firstRun = false;
    try {
      firstRun = typeof localStorage !== "undefined" && !localStorage.getItem("tc.settings");
    } catch {
      /* storage refused: treat as a returning visit, change nothing */
    }

    const vibration =
      firstRun && neverChosen && supported && isTouchPrimary() ? true : stored.vibration;

    // Section 107: detect the device language, never force it. When the user
    // has left the language on Automatic (the default), it follows the device
    // on every load; once they pick one, that choice is kept.
    const localeAuto = stored.localeAuto ?? true;
    const locale = localeAuto ? deviceLocale() : stored.locale || "en";

    const next = { ...stored, vibration, locale, localeAuto };
    applyTheme(next.theme);
    // The ticker is a module singleton, so the chosen voice and volume have to
    // be pushed into it rather than read from the store on every tap.
    ticker.setSound(next.tickSound as never);
    ticker.setVolume(next.volume);
    set({ ...next, hydrated: true, vibrationSupported: supported });
    saveSettings(next);
  },

  set(key, value) {
    set({ [key]: value } as Partial<SettingsStore>);
    if (key === "tickSound") ticker.setSound(value as never);
    if (key === "volume") ticker.setVolume(value as number);
    const {
      hydrated,
      vibrationSupported,
      hydrate,
      set: _s,
      toggle,
      setTheme,
      setLanguage,
      ...rest
    } = get();
    void hydrated;
    void vibrationSupported;
    void hydrate;
    void _s;
    void toggle;
    void setTheme;
    void setLanguage;
    saveSettings({ ...(rest as Settings), [key]: value });
    broadcast({ type: "settings-changed" });
  },

  toggle(key) {
    get().set(key, !get()[key]);
  },

  setTheme(theme) {
    applyTheme(theme);
    get().set("theme", theme);
  },

  setLanguage(code) {
    const auto = code === "auto";
    const locale = auto ? deviceLocale() : code;
    // A first move to an Eastern-Arabic-script language brings its own digits
    // along, unless the user has already set numerals themselves.
    const wantEastern = EASTERN_NUMERAL_LOCALES.includes(locale);
    set({ localeAuto: auto, locale });
    const patch: Partial<Settings> = { localeAuto: auto, locale };
    if (wantEastern && get().numerals === "latin") patch.numerals = "arabic-indic";
    if (!wantEastern && auto && get().numerals === "arabic-indic") patch.numerals = "latin";
    const { hydrated, vibrationSupported, hydrate, set: _s, toggle, setTheme, setLanguage, ...rest } =
      get();
    void hydrated; void vibrationSupported; void hydrate; void _s; void toggle; void setTheme; void setLanguage;
    set(patch as Partial<SettingsStore>);
    saveSettings({ ...(rest as Settings), ...patch });
    broadcast({ type: "settings-changed" });
  },
}));

export { THEME_BOOTSTRAP } from "@/lib/theme-bootstrap";
