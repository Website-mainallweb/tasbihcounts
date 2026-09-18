import Link from "next/link";

import { CURRENT_PLAN } from "@/lib/payments/plans";

const POINTS = [
  ["No ads", "on every device"],
  ["Sync", "across phone, tablet and computer"],
  ["Backup", "that survives a lost phone"],
  ["Reminders", "at the time you choose"],
] as const;

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.14" />
      <path d="M7.5 12.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The Premium offer as a card: a sticky side card beside an article, or a wide
 * strip under Streak and Stats. Server-rendered, no JavaScript; hidden by CSS
 * for a Premium browser (html[data-premium]).
 */
export default function PremiumCard({ variant = "side" }: { variant?: "side" | "inline" }) {
  if (variant === "inline") {
    return (
      <aside className="side-card premium-card premium-inline" lang="en" aria-label="Premium">
        <span className="premium-inline-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 7.5l4.6 4.2L12 4.5l4.4 7.2L21 7.5 19.2 18H4.8L3 7.5zM5 21h14"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div>
          <p className="side-title">Keep this record safe on every device</p>
          <p>
            Your streak and stats live in this browser. Premium syncs them to your account — {CURRENT_PLAN.display}{" "}
            once, for life, with no ads.
          </p>
        </div>
        <Link href="/premium/" className="btn btn-primary" prefetch={false}>
          Get Premium
        </Link>
      </aside>
    );
  }

  return (
    <aside className="side-card premium-card" lang="en" aria-label="Premium">
      <p className="eyebrow">Premium</p>
      <p className="side-title">Your practice, on every device</p>
      <p className="price">
        <b>{CURRENT_PLAN.display}</b> once · lifetime
      </p>
      <ul className="check-list">
        {POINTS.map(([t, d]) => (
          <li key={t}>
            <Check />
            <span>
              <strong>{t}</strong> {d}
            </span>
          </li>
        ))}
      </ul>
      <Link href="/premium/" className="btn btn-primary btn-block" prefetch={false}>
        Get Premium
      </Link>
      <p className="auth-foot">The counter stays free for everyone.</p>
    </aside>
  );
}
