"use client";

import { useEffect, useState } from "react";

/**
 * The counter used to carry its own brand row with a language and a theme
 * button. That row duplicated the site header, so it is hidden on the page and
 * these two controls take its place in the header instead.
 *
 * They are proxies: the real buttons still live inside the widget, still hold
 * all the behaviour, and these forward a click. Nothing about the engine had to
 * learn where its buttons are drawn.
 */
export default function CounterControls() {
  const [ready, setReady] = useState(false);
  const [langGlyph, setLangGlyph] = useState("अ");

  useEffect(() => {
    // The widget mounts in its own effect, which may land after this one.
    let tries = 0;
    let timer = 0;

    const find = () => {
      const lang = document.getElementById("njcLang");
      if (!lang) {
        if (tries++ < 40) timer = window.setTimeout(find, 50);
        return;
      }
      setReady(true);
      setLangGlyph(lang.textContent?.trim() || "अ");

      const observer = new MutationObserver(() =>
        setLangGlyph(lang.textContent?.trim() || "अ"),
      );
      observer.observe(lang, { childList: true, characterData: true, subtree: true });
      cleanup = () => observer.disconnect();
    };

    let cleanup = () => {};
    find();

    return () => {
      window.clearTimeout(timer);
      cleanup();
    };
  }, []);

  if (!ready) return null;

  const press = (id: string) => () =>
    (document.getElementById(id) as HTMLButtonElement | null)?.click();

  return (
    <div className="counter-controls">
      <button
        type="button"
        onClick={press("njcLang")}
        aria-label="Switch language"
        title="Switch language"
      >
        <span aria-hidden="true">{langGlyph}</span>
      </button>
      <button
        type="button"
        onClick={press("njcThemeBtn")}
        aria-label="Switch theme"
        title="Switch theme"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
