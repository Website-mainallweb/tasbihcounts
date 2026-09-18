"use client";

/**
 * Bottom sheet primitive.
 * Specification sections 31, 68, 71 (focus trap, escape, restore focus).
 *
 * Hand rolled rather than pulled from a library so the visual design is ours
 * and not a recognisable third-party default (section 68).
 */

import { useCallback, useEffect, useRef } from "react";

export function Sheet({
  open,
  onClose,
  title,
  children,
  // dvh, not vh: on a phone vh is the tallest the viewport ever gets, so with
  // the browser bars showing, an 82vh sheet is taller than the screen and its
  // last row sits under the address bar.
  maxHeight = "82dvh",
  size = "dialog",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxHeight?: string;
  /**
   * How wide this gets from `sm` up. A settings surface is a DIALOG and should
   * read like one — a full-bleed 1120px panel that slid up from the bottom of
   * a desktop screen is a phone sheet wearing a big coat. Only genuinely wide
   * content (pricing, history) asks for "wide".
   */
  size?: "dialog" | "wide";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const startY = useRef<number | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    document.body.classList.add("no-scroll");

    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      returnFocusRef.current?.focus?.();
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
        style={{ animation: "tc-fade 180ms var(--ease) both" }}
      />
      <div
        ref={panelRef}
        className={`sheet-panel relative w-full rounded-t-[var(--radius-xl)] border border-border bg-surface shadow-float sm:rounded-[var(--radius-xl)] ${
          size === "wide" ? "sm:max-w-[880px]" : "sm:max-w-[560px]"
        }`}
        style={{
          maxHeight,
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        }}
      >
        {/* The drag-to-dismiss gesture lives on the HEADER only, never on the
            whole panel. It used to sit on the panel, so scrolling the content
            downward past 90px was read as a swipe-down and the sheet closed
            itself mid-scroll. The grabber and title are the conventional and
            safe place to grab a bottom sheet. */}
        <div
          className="flex items-center justify-between gap-3 px-5 pt-3 pb-2"
          style={{ touchAction: "none" }}
          onTouchStart={(e) => {
            startY.current = e.touches[0]?.clientY ?? null;
          }}
          onTouchEnd={(e) => {
            const s = startY.current;
            const end = e.changedTouches[0]?.clientY ?? null;
            if (s !== null && end !== null && end - s > 70) close();
            startY.current = null;
          }}
        >
          {/* The grabber is a touch affordance. On a pointer device there is
              nothing to grab, and it is the single detail that makes a desktop
              dialog read as a phone sheet. */}
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-border-strong sm:hidden"
          />
          <h2 className="pt-3 text-[17px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={close}
            className="-me-2 mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div
          className="thin-scroll overflow-y-auto overscroll-contain px-5 pb-2"
          style={{ maxHeight: `calc(${maxHeight} - 68px)` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function SheetSection({
  label,
  children,
  quietLabel,
}: {
  label: string;
  children: React.ReactNode;
  /** Hide the heading on phones so a long list can be one flat screen. */
  quietLabel?: boolean;
}) {
  return (
    <section className={quietLabel ? "py-1.5 md:py-3" : "py-3"}>
      <h3
        className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle ${
          quietLabel ? "sr-only md:not-sr-only md:mb-2 md:block" : ""
        }`}
      >
        {label}
      </h3>
      {children}
    </section>
  );
}

export function Row({
  label,
  hint,
  right,
  onClick,
  href,
  danger,
  disabled,
}: {
  label: string;
  hint?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  /** A row that navigates is a LINK, not a button that happens to navigate. */
  href?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  const Tag = href ? "a" : onClick ? "button" : "div";
  return (
    <Tag
      {...(href ? { href } : {})}
      {...(!href && onClick ? { type: "button" as const, onClick, disabled } : {})}
      className={`flex w-full items-center justify-between gap-4 rounded-[var(--radius-sm)] px-3 py-3 text-left transition-colors ${
        (href || onClick) && !disabled ? "hover:bg-surface-sunken" : ""
      } ${disabled ? "opacity-45" : ""}`}
    >
      <span className="min-w-0">
        <span className={`block text-[15px] ${danger ? "text-danger" : "text-fg"}`}>
          {label}
        </span>
        {hint ? (
          <span className="mt-0.5 block text-[13px] leading-snug text-fg-muted">
            {hint}
          </span>
        ) : null}
      </span>
      {right ? <span className="shrink-0">{right}</span> : null}
    </Tag>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // The track stays 28px tall because that is what reads as a switch; the
      // BUTTON is 44px, so the target meets section 71.2 without the control
      // looking like a slab.
      className={`relative grid h-11 w-[48px] shrink-0 place-items-center ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative block h-[28px] w-[48px] rounded-full transition-colors duration-200 ${
          checked ? "bg-accent" : "bg-border-strong"
        }`}
      >
        <span
          className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-soft transition-transform duration-200"
          style={{
            transform: `translateX(${checked ? 23 : 3}px)`,
            transitionTimingFunction: "var(--ease-brand)",
          }}
        />
      </span>
    </button>
  );
}
