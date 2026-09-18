"use client";

import Link from "next/link";

import LoginForm from "./LoginForm";
import type { AuthTab } from "@/lib/auth-ui";
import { CURRENT_PLAN } from "@/lib/payments/plans";

type Props = {
  tab: AuthTab;
  onTab: (tab: AuthTab) => void;
  onClose: () => void;
  next: string;
  supportEmail: string;
};

export const PREMIUM_POINTS = [
  ["No ads", "A calm page on every device you log in on."],
  ["Every device, one practice", "Counts, rounds, streak and history stay in step."],
  ["Safe if a phone is lost", "Your history lives in your account, not one browser."],
  ["Gentle reminders", "A nudge at your time, only when practice is still waiting."],
] as const;

export function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.14" />
      <path d="M7.5 12.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * What the sign-in popup shows. Loaded on first open only — it carries the
 * Supabase client, which no page may download up front (scripts/check-bundle.mjs).
 *
 * Two tabs, because there is no "register": an account is made by buying
 * Premium, so the second tab explains that and sends people to checkout.
 */
export default function AuthPanel({ tab, onTab, onClose, next, supportEmail }: Props) {
  return (
    <div className="auth-panel">
      <aside className="auth-aside" aria-hidden="true">
        <p className="auth-aside-kicker">Tasbih Counts Premium</p>
        <p className="auth-aside-title">Your practice, on every device.</p>
        <ul>
          {PREMIUM_POINTS.map(([t]) => (
            <li key={t}>
              <Check />
              {t}
            </li>
          ))}
        </ul>
        <p className="auth-aside-price">
          <b>{CURRENT_PLAN.display}</b> once · lifetime
        </p>
      </aside>

      <div className="auth-main">
        {/* B29: an ARIA tab list — arrow keys move between the two tabs and only the
            selected one is in the Tab order. */}
        <div
          className="seg"
          role="tablist"
          aria-label="Log in or get Premium"
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const nextTab: AuthTab = e.key === "Home" ? "login" : e.key === "End" ? "premium" : tab === "login" ? "premium" : "login";
            onTab(nextTab);
            requestAnimationFrame(() => document.getElementById(`auth-tab-${nextTab}`)?.focus());
          }}
        >
          {(["login", "premium"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`auth-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`auth-pane-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => onTab(t)}
            >
              {t === "login" ? "Log in" : "Get Premium"}
            </button>
          ))}
        </div>

        {/* B27: both panes stay mounted, so an email typed before looking at
            Premium is still there on the way back. */}
        <div id="auth-pane-login" role="tabpanel" aria-labelledby="auth-tab-login" hidden={tab !== "login"}>
          <LoginForm
            initialError={null}
            supportEmail={supportEmail}
            next={next}
            premiumAction={
              <>
                No account yet? Accounts are created when you buy Premium.{" "}
                <button type="button" className="link-btn" onClick={() => onTab("premium")}>
                  Get Premium
                </button>
              </>
            }
          />
        </div>
        <div id="auth-pane-premium" role="tabpanel" aria-labelledby="auth-tab-premium" hidden={tab !== "premium"}>
          <div className="auth-card">
            <div className="auth-card-head">
              <h2>Get Premium</h2>
              <p>One payment of {CURRENT_PLAN.display}, yours for life. No subscription, nothing to cancel.</p>
            </div>
            <ul className="check-list">
              {PREMIUM_POINTS.map(([t, d]) => (
                <li key={t}>
                  <Check />
                  <span>
                    <strong>{t}</strong> {d}
                  </span>
                </li>
              ))}
            </ul>
            {/* Closed by the navigation itself (AuthDialog), so Back is not spent
                undoing it — except when already on /premium/, where nothing navigates. */}
            <Link
              className="btn btn-primary btn-block"
              href="/premium/#buy"
              onClick={() => {
                if (window.location.pathname.startsWith("/premium")) onClose();
              }}
            >
              Continue to Premium · {CURRENT_PLAN.display}
            </Link>
            <p className="auth-foot">
              Pay with the email you want to log in with — your account is created with it the moment the payment is
              confirmed. The counter itself stays free.
            </p>
            <div className="auth-premium-note">
              Already bought Premium?{" "}
              <button type="button" className="link-btn" onClick={() => onTab("login")}>
                Log in
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
