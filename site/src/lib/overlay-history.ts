"use client";

/**
 * Back closes an overlay (B26).
 *
 * On Android, Back is how people close things. The counter's own sheets already
 * push one history entry (#41); the log-in popup and the side menu did not, so
 * Back left the page with them open. Opening pushes an entry on the same URL;
 * Back pops it and closes; closing any other way takes the entry away again —
 * unless a link inside the overlay closed it (keepNextOverlayEntry): a page, or a
 * counter sheet like /#library, whose own entry that Back would pop.
 *
 * Taking an entry away is itself a Back, and it arrives later. The menu's Log in
 * closes the menu and opens the popup in one go, so that Back can land after the
 * popup has pushed its own entry. Pops this module causes are marked, and no
 * overlay treats them as the person pressing Back.
 */

let ownPops = 0;
let keepNext = false;
const OWN = "__njcOwnPop";
type Marked = PopStateEvent & { [OWN]?: boolean };

if (typeof window !== "undefined") {
  // Registered before any overlay's listener, so it marks the event first.
  window.addEventListener("popstate", (e) => {
    if (ownPops > 0) {
      ownPops--;
      (e as Marked)[OWN] = true;
    }
  });
}

/** The overlay closing next was closed by a navigation: leave its entry. */
export function keepNextOverlayEntry(): void {
  keepNext = true;
  window.setTimeout(() => {
    keepNext = false;
  }, 1000);
}

export function pushOverlay(onBack: () => void): () => void {
  let pushed = false;
  const href = window.location.href;
  try {
    history.pushState(history.state, "", href);
    pushed = true;
  } catch {
    return () => {};
  }
  const onPop = (e: PopStateEvent) => {
    if ((e as Marked)[OWN] || !pushed) return;
    pushed = false;
    window.removeEventListener("popstate", onPop);
    onBack();
  };
  window.addEventListener("popstate", onPop);
  return () => {
    window.removeEventListener("popstate", onPop);
    if (!pushed) return;
    pushed = false;
    if (keepNext) {
      keepNext = false;
      return;
    }
    if (window.location.href !== href) return;
    ownPops++;
    history.back();
  };
}
