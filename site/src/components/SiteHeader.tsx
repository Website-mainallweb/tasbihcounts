"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ComponentType, type MouseEvent } from "react";
import BrandMark from "./BrandMark";
import CounterControls from "./CounterControls";
import StreakChip from "./StreakChip";
import { openAuth, useHasSession } from "@/lib/auth-ui";
import { PROMO_KEY } from "@/lib/promo";
import { APP_NAV, MORE_NAV, PREMIUM_ICON, isCurrent, isSheet } from "@/lib/nav";

/** Scroll past this before the bar is allowed to leave. */
const REVEAL_AT = 90;
/** Ignore jitter smaller than this so the bar does not flicker. */
const DEADZONE = 6;

type DrawerProps = { pathname: string; hasSession: boolean; onClose: (restoreFocus: boolean) => void };

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Log in opens the popup; without JavaScript it is a plain link to the page. */
export function logIn(e: MouseEvent<HTMLAnchorElement>) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  /* B28: on the log-in page itself, go to its form rather than open a second one. */
  if (window.location.pathname.startsWith("/login")) {
    document.querySelector<HTMLInputElement>(".auth-page input[type=email]")?.focus();
    return;
  }
  openAuth("login");
}

/**
 * The site's one navigation.
 *
 * From 1024 up: the logo, the counter's destinations beside it, More for the
 * other pages, and at the far end the streak, the counter's language and theme,
 * Log in and Get Premium. Below 1024 the links move into a side drawer
 * (SiteDrawer, loaded on the first tap) and the bar keeps only what is used
 * every visit.
 *
 * The drawer is a sibling of the header, not a child: the header slides away on
 * scroll with a transform, and a transformed parent would pin a fixed drawer to
 * itself instead of to the screen.
 */
export default function SiteHeader() {
  const pathname = usePathname();
  const cookieSession = useHasSession();
  /* B52: a session cookie the server no longer accepts is not a session. */
  const [signedOut, setSignedOut] = useState(false);
  const hasSession = cookieSession && !signedOut;
  const [open, setOpen] = useState(false);
  const [Drawer, setDrawer] = useState<ComponentType<DrawerProps> | null>(null);
  const [scrolledAway, setScrolledAway] = useState(false);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  /*
   * Close the drawer when the route changes. Adjusted during render rather than
   * in an effect: a tap on a drawer link navigates without unmounting the
   * header, and an effect would paint the new page with the old drawer still
   * open before a second render took it away.
   */
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  const hidden = open ? false : scrolledAway;
  const lastY = useRef(0);

  useEffect(() => {
    if (open) return;
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY.current;
      if (Math.abs(dy) < DEADZONE) return;
      lastY.current = y;
      const away = y > REVEAL_AT && dy > 0;
      setScrolledAway(away);
      /* B51: an open More menu leaves with the bar instead of floating on its own. */
      if (away && moreRef.current?.open) moreRef.current.open = false;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open]);

  /* A <details> menu closes itself on its own summary, not on a click anywhere
     else or on Escape. Both are what people expect of a menu. */
  useEffect(() => {
    const onClick = (e: globalThis.MouseEvent) => {
      /* The promo bar is server-rendered with no script of its own; its close
         button is answered here. The choice is remembered (lib/promo.ts). */
      if ((e.target as Element).closest?.("[data-promo-close]")) {
        try {
          localStorage.setItem(PROMO_KEY, String(Date.now()));
        } catch {
          // Storage refused: it hides for this page view only.
        }
        document.documentElement.setAttribute("data-promo-off", "1");
      }
      const d = moreRef.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      const d = moreRef.current;
      if (e.key === "Escape" && d?.open) {
        d.open = false;
        d.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  /* B01, B50, B52, B54: Premium status, a dead cookie and the theme across tabs,
     loaded when the page is idle (lib/header-idle.ts). */
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    const load = () =>
      void import("@/lib/header-idle").then(
        (m) => {
          if (!cancelled) stop = m.startHeaderIdle(cookieSession, () => setSignedOut(true));
        },
        () => {},
      );
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(load);
    else window.setTimeout(load, 1500);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [cookieSession]);

  /* B40: fetch the menu while the page is idle, so an installed app that goes
     offline still has it (the service worker keeps what was fetched). */
  useEffect(() => {
    if (window.innerWidth >= 1024) return;
    const load = () =>
      void import("./SiteDrawer").then(
        (m) => setDrawer(() => m.default),
        () => {},
      );
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(load);
    else window.setTimeout(load, 2500);
  }, []);

  /* The mala toast (PremiumNudgeToast): fetched on the counter page only, once
     the page is idle — the counter's first load is held to a budget, and a toast
     that may never show should cost it nothing. */
  const [Toast, setToast] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (pathname !== "/" || Toast) return;
    const load = () => void import("./PremiumNudgeToast").then((m) => setToast(() => m.default));
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(load);
    else window.setTimeout(load, 2000);
  }, [pathname, Toast]);

  const toggle = () => {
    if (!Drawer) {
      import("./SiteDrawer").then(
        (m) => {
          setDrawer(() => m.default);
          setOpen(true);
        },
        () => {},
      );
      return;
    }
    setOpen((v) => !v);
  };

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  const moreIsCurrent = MORE_NAV.some((d) => isCurrent(d.href, pathname));

  return (
    <>
      <header className="site-header" lang="en" data-hidden={hidden ? "true" : undefined}>
        <div className="wrap header-row">
          <BrandMark height={30} />

          <nav id="site-nav" className="site-nav" aria-label="Primary">
            {APP_NAV.map((d) => {
              /* A sheet is an action, not a place: a plain anchor, because
                 next/link navigates with pushState and pushState does not fire
                 hashchange. */
              const As = isSheet(d.href) ? ("a" as const) : Link;
              return (
                <As key={d.href} href={d.href} aria-current={isCurrent(d.href, pathname) ? "page" : undefined}>
                  {d.label}
                </As>
              );
            })}
            {/* Keyed by route so it is closed after navigating. */}
            <details className="nav-more" ref={moreRef} key={pathname}>
              <summary aria-current={moreIsCurrent ? "page" : undefined}>More</summary>
              <div className="nav-more-menu">
                {MORE_NAV.map((d) => (
                  <Link key={d.href} href={d.href} aria-current={isCurrent(d.href, pathname) ? "page" : undefined}>
                    {d.label}
                  </Link>
                ))}
              </div>
            </details>
          </nav>

          <div className="header-end">
            <StreakChip />
            {/* Keyed by route so a navigation remounts it and it finds the
                widget's buttons again. */}
            <CounterControls key={pathname} />

            {hasSession ? (
              <Link
                href="/account/"
                className="btn btn-ghost hdr-account"
                aria-label="Account"
                aria-current={pathname.startsWith("/account") ? "page" : undefined}
                prefetch={false}
              >
                <Icon d="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0" />
                <span>Account</span>
              </Link>
            ) : (
              <>
                <a href="/login/" className="btn btn-ghost hdr-login" onClick={logIn}>
                  Log in
                </a>
                <Link
                  href="/premium/"
                  className="btn btn-primary hdr-premium"
                  prefetch={false}
                  aria-current={pathname.startsWith("/premium") ? "page" : undefined}
                >
                  <svg className="crown" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d={PREMIUM_ICON} fill="currentColor" /></svg>
                  <span>Get Premium</span>
                </Link>
              </>
            )}

            <button
              ref={toggleRef}
              type="button"
              className="icon-btn nav-toggle"
              aria-expanded={open}
              aria-controls="site-drawer"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={toggle}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div id="site-drawer" className="drawer" lang="en" hidden={!open}>
        {open && Drawer && <Drawer pathname={pathname} hasSession={hasSession} onClose={close} />}
      </div>

      {Toast && <Toast />}
    </>
  );
}
