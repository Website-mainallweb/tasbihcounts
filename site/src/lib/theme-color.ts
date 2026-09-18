/**
 * Puts a counter theme on the whole page: the palette on <html>, and the browser
 * bar colour to match it (B54 — the bar stayed cream above a Ratri page, because
 * the viewport meta only knows the system light/dark setting).
 */
export function applyTheme(theme: string): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  if (!bg) return;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", bg);
  });
}
