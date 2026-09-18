"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";

import { AUTH_EVENT, type AuthTab } from "@/lib/auth-ui";
import { safeNext } from "@/lib/auth-redirect";
import { keepNextOverlayEntry, pushOverlay } from "@/lib/overlay-history";

type PanelProps = {
  tab: AuthTab;
  onTab: (tab: AuthTab) => void;
  onClose: () => void;
  next: string;
  supportEmail: string;
};

/**
 * The sign-in popup: a centred dialog on a wide screen, a sheet from the bottom
 * on a phone. A native <dialog> opened with showModal(), so focus is held inside
 * it, the page behind is inert and Escape closes it, with no library.
 *
 * Its contents are a dynamic import made on the first open: the form carries the
 * Supabase client, and no prerendered page may ship that up front.
 *
 * /login/ still exists as a page for a direct visit, an email link or a browser
 * without JavaScript; the header's Log in is a real link to it.
 */
export default function AuthDialog({ supportEmail, initialTab }: { supportEmail: string; initialTab: AuthTab }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const [tab, setTab] = useState<AuthTab>("login");
  const [Panel, setPanel] = useState<ComponentType<PanelProps> | null>(null);
  const [failed, setFailed] = useState(false);
  /* Remount the form on each open so a half-typed state does not linger. */
  const [session, setSession] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const releaseHistory = useRef<(() => void) | null>(null);

  const close = useCallback(() => ref.current?.close(), []);

  const openWith = useCallback((next: AuthTab) => {
    const dialog = ref.current;
    if (!dialog) return;
    setTab(next);
    setSession((n) => n + 1);
    if (!dialog.open) {
      opener.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      /* B25: locked here, where it opens. A MutationObserver attached after this
         first showModal() never saw it, so the page scrolled behind the popup. */
      document.documentElement.classList.add("auth-open");
      /* B26: Back closes the popup instead of leaving the page. */
      releaseHistory.current = pushOverlay(() => {
        releaseHistory.current = null;
        dialog.close();
      });
      /* Focus the sheet itself, not the close button showModal would pick:
         a keyboard user starts at the top, and nobody sees a ring on ×. */
      dialog.querySelector<HTMLElement>(".auth-dialog-inner")?.focus();
    }
  }, []);

  /* Loaded by AuthHost in answer to the first request: open for that one, and
     fetch the form itself. */
  useEffect(() => {
    openWith(initialTab);
    import("./AuthPanel").then(
      (m) => setPanel(() => m.default),
      () => setFailed(true),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => openWith((e as CustomEvent<AuthTab>).detail ?? "login");
    window.addEventListener(AUTH_EVENT, onOpen);
    return () => window.removeEventListener(AUTH_EVENT, onOpen);
  }, [openWith]);

  /* A navigation (the Premium button inside it) closes the popup. */
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;
    keepNextOverlayEntry();
    close();
  }, [pathname, close]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    /* Unlock the page, give the history entry back and restore focus — once per
       close, whatever triggered it. Chrome 152+ fires only `toggle` when
       dialog.close() runs (the × button, Back, an inner navigation); Escape and
       older engines fire `close`. Listening to both, guarded by the scroll-lock
       class so they never both run, is what keeps the page from staying locked
       after the popup is dismissed. */
    const cleanup = () => {
      if (!document.documentElement.classList.contains("auth-open")) return;
      document.documentElement.classList.remove("auth-open");
      releaseHistory.current?.();
      releaseHistory.current = null;
      opener.current?.focus?.({ preventScroll: true });
    };
    const onToggle = (e: Event) => {
      if ((e as Event & { newState?: string }).newState === "closed") cleanup();
    };
    /* A click on the backdrop lands on the dialog element itself. */
    const onClick = (e: MouseEvent) => {
      if (e.target === dialog) dialog.close();
    };
    dialog.addEventListener("close", cleanup);
    dialog.addEventListener("toggle", onToggle);
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("close", cleanup);
      dialog.removeEventListener("toggle", onToggle);
      dialog.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <dialog ref={ref} className="auth-dialog" lang="en" aria-label={tab === "login" ? "Log in" : "Get Premium"}>
      <div className="auth-dialog-inner" tabIndex={-1}>
        <span className="sheet-grip" aria-hidden="true" />
        <button type="button" className="icon-btn auth-close" aria-label="Close" onClick={close}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {Panel ? (
          <Panel
            key={session}
            tab={tab}
            onTab={setTab}
            onClose={close}
            next={safeNext(pathname)}
            supportEmail={supportEmail}
          />
        ) : failed ? (
          <p className="auth-loading">
            Could not load the form. <a href="/login/">Open the log-in page</a>.
          </p>
        ) : (
          <p className="auth-loading" role="status">
            <span className="spinner" aria-hidden="true" /> Loading…
          </p>
        )}
      </div>
    </dialog>
  );
}
