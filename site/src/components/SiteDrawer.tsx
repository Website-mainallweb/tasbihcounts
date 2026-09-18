"use client";

import Link from "next/link";
import { useEffect, useRef, type MouseEvent } from "react";

import BrandMark from "./BrandMark";
import { openAuth } from "@/lib/auth-ui";
import { keepNextOverlayEntry, pushOverlay } from "@/lib/overlay-history";
import { APP_NAV, LOGIN_ICON, MORE_NAV, PREMIUM_ICON, isCurrent, isSheet, type AppDestination } from "@/lib/nav";

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Props = {
  pathname: string;
  hasSession: boolean;
  onClose: (restoreFocus: boolean) => void;
};

/**
 * The menu below 1024px: a panel from the right with the counter's destinations
 * as cards, the other pages as a list, and Log in / Get Premium at the foot.
 *
 * Loaded on the first tap of the menu button, not with the page: most visits
 * never open it, and the counter's page is held to a JavaScript budget.
 */
export default function SiteDrawer({ pathname, hasSession, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  /* B26: Back closes the menu instead of leaving the page. */
  useEffect(() => pushOverlay(() => closeRef.current(true)), []);

  /* Focus moves in, Tab stays inside, Escape closes, the page does not scroll. */
  useEffect(() => {
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("a[href], button")?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose(true);
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("nav-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("nav-open");
    };
  }, [onClose]);

  const link = (d: AppDestination, card: boolean) => {
    /* A sheet is an action, not a place: a plain anchor, because next/link
       navigates with pushState and pushState does not fire hashchange. */
    const As = isSheet(d.href) ? ("a" as const) : Link;
    return (
      <As
        key={d.href}
        href={d.href}
        className={card ? "drawer-link" : "drawer-row"}
        aria-current={isCurrent(d.href, pathname) ? "page" : undefined}
        onClick={() => {
          keepNextOverlayEntry();
          if (isSheet(d.href)) onClose(false);
        }}
      >
        {card ? (
          <>
            <span className="drawer-icon">
              <Icon d={d.icon} />
            </span>
            <span className="drawer-text">
              <b>{d.label}</b>
              <small>{d.hint}</small>
            </span>
          </>
        ) : (
          d.label
        )}
      </As>
    );
  };

  const logIn = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onClose(false);
    /* B28: on the log-in page, its own form — not a second one on top. */
    if (pathname.startsWith("/login")) {
      window.setTimeout(() => document.querySelector<HTMLInputElement>(".auth-page input[type=email]")?.focus(), 0);
      return;
    }
    openAuth("login");
  };

  return (
    <>
      <div className="drawer-scrim" onClick={() => onClose(false)} aria-hidden="true" />
      <div className="drawer-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="Menu">
        <div className="drawer-head">
          <BrandMark height={28} />
          <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => onClose(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="drawer-body" aria-label="Menu">
          <p className="drawer-group">Counter</p>
          <div className="drawer-grid">{APP_NAV.map((d) => link(d, true))}</div>
          <p className="drawer-group">More</p>
          <div className="drawer-list">{MORE_NAV.map((d) => link(d, false))}</div>
        </nav>

        <div className="drawer-foot">
          {hasSession ? (
            <Link href="/account/" className="btn btn-primary btn-block" prefetch={false} onClick={keepNextOverlayEntry}>
              Your account
            </Link>
          ) : (
            <>
              <Link href="/premium/" className="btn btn-primary btn-block" prefetch={false} onClick={keepNextOverlayEntry}>
                <svg className="crown" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d={PREMIUM_ICON} fill="currentColor" /></svg> Get Premium · lifetime
              </Link>
              <a href="/login/" className="btn btn-outline btn-block" onClick={logIn}>
                <Icon d={LOGIN_ICON} size={16} /> Log in
              </a>
            </>
          )}
        </div>
      </div>
    </>
  );
}
