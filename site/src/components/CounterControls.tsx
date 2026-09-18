"use client";

import { useEffect, useState } from "react";

/**
 * The theme switch in the header: light and dark, one tap each way.
 *
 * The counter's More sheet holds the full choice (system, light, dark and the
 * two Premium themes); this is the shortcut. It is on every page, so it does not
 * load the counter's settings store: it reads and writes the same `tc.settings`
 * record directly and tells an open counter through the same channel the counter
 * uses between tabs (lib/tabs.ts), which makes the store re-read it.
 */
const KEY = "tc.settings";
const CHANNEL = "tasbihcounts";

type Theme = "system" | "light" | "dark" | "noor" | "heritage";

function readTheme(): Theme {
  try {
    const t = (JSON.parse(localStorage.getItem(KEY) || "{}") as { theme?: Theme }).theme;
    return t ?? "system";
  } catch {
    return "system";
  }
}

function isDark(theme: Theme): boolean {
  if (theme === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches;
  return theme !== "light";
}

export default function CounterControls() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => setDark(isDark(readTheme()));
    read();

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (e) => {
        if ((e.data as { type?: string })?.type === "settings-changed") read();
      };
    } catch {
      /* no channel: the storage event still covers other tabs */
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) read();
    };
    media.addEventListener("change", read);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", read);
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, []);

  const toggle = () => {
    const next: Theme = dark ? "light" : "dark";
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, unknown>;
      localStorage.setItem(KEY, JSON.stringify({ ...stored, theme: next }));
    } catch {
      /* storage refused: the page still changes, it just will not remember */
    }
    const root = document.documentElement;
    root.setAttribute("data-theme", next);
    const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
      if (bg) m.setAttribute("content", bg);
    });
    try {
      const c = new BroadcastChannel(CHANNEL);
      c.postMessage({ type: "settings-changed", from: "header" });
      c.close();
    } catch {
      /* nothing else to tell */
    }
    setDark(!dark);
  };

  return (
    <div className="counter-controls">
      <button
        type="button"
        onClick={toggle}
        aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
        title="Theme"
      >
        {dark ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
            <path
              d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
