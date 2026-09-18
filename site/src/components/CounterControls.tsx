"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/stores/settings-store";

/**
 * The theme switch in the header: light and dark, one tap each way.
 *
 * The counter's More sheet holds the full choice (system, light, dark and the
 * two Premium themes); this is the shortcut. It reads the theme actually on the
 * page, so "system" shows the moon or the sun the system picked.
 */
export default function CounterControls() {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const hydrate = useSettings((s) => s.hydrate);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => setDark(theme === "system" ? media.matches : theme !== "light");
    read();
    media.addEventListener("change", read);
    return () => media.removeEventListener("change", read);
  }, [theme]);

  return (
    <div className="counter-controls">
      <button
        type="button"
        onClick={() => setTheme(dark ? "light" : "dark")}
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
