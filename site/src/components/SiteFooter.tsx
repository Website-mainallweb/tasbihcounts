import Link from "next/link";
import BrandMark from "./BrandMark";
import { CURRENT_PLAN } from "@/lib/payments/plans";
import { NAV, SITE_TAGLINE, SOCIAL } from "@/lib/site";

/** The same six links the footer always carried, grouped into columns. */
const SITE_LINKS = NAV.filter((n) => ["/", "/about-us/", "/contact-us/"].includes(n.href));
const LEGAL_LINKS = NAV.filter((n) => !SITE_LINKS.includes(n));
const PRACTICE_LINKS = [
  { label: "Streak", href: "/streak/" },
  { label: "Stats", href: "/stats/" },
  { label: "Premium", href: "/premium/" },
];

export default function SiteFooter() {
  return (
    <footer className="site-footer" lang="en">
      {/* Folds away for a Premium browser (html[data-premium]). */}
      <div className="wrap">
        <div className="footer-cta">
          <div>
            <p className="footer-cta-title">Your practice, safe on every device</p>
            <p className="footer-cta-text">
              Premium adds sync across your devices, reminders and an ad-free page — {CURRENT_PLAN.display} once,
              for life.
            </p>
          </div>
          <Link href="/premium/" className="btn btn-primary" prefetch={false}>
            Get Premium
          </Link>
        </div>
      </div>

      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <BrandMark height={30} />
            <p className="tag">
              {SITE_TAGLINE}. Count your dhikr and keep your daily remembrance steady. The counter is free and keeps your
              practice on your own device; Premium adds sync across your devices.
            </p>
            {(SOCIAL.instagram || SOCIAL.facebook) && (
            <div className="footer-social">
              {SOCIAL.instagram && (
              <a href={SOCIAL.instagram} target="_blank" rel="noopener noreferrer" aria-label="Tasbih Counts on Instagram">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.7" />
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
                  <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" />
                </svg>
              </a>
              )}
              {SOCIAL.facebook && (
              <a href={SOCIAL.facebook} target="_blank" rel="noopener noreferrer" aria-label="Tasbih Counts on Facebook">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M14 9V7.2c0-.8.3-1.2 1.2-1.2H17V3h-2.6C11.8 3 11 4.4 11 6.6V9H9v3h2v9h3v-9h2.2l.4-3H14z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              )}
            </div>
            )}
          </div>

          <nav className="footer-col" aria-label="Footer">
            <p className="footer-title">Pages</p>
            {SITE_LINKS.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>

          <nav className="footer-col" aria-label="Your practice">
            <p className="footer-title">Practice</p>
            {PRACTICE_LINKS.map((item) => (
              <Link key={item.href} href={item.href} prefetch={false}>
                {item.label}
              </Link>
            ))}
          </nav>

          <nav className="footer-col" aria-label="Legal">
            <p className="footer-title">Legal</p>
            {LEGAL_LINKS.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <p className="legal">Copyright © 2026 Tasbih Counts</p>
      </div>
    </footer>
  );
}
