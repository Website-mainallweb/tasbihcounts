import Link from "next/link";

import { CURRENT_PLAN } from "@/lib/payments/plans";

/**
 * The announcement strip above the header. A server component with no script:
 * the page's JavaScript budget has no room for a banner.
 *
 * Hidden by CSS — for a Premium browser (html[data-premium]), after it was closed
 * (html[data-promo-off], set before paint by lib/promo.ts; the close button is
 * answered in SiteHeader), on pages that are already about buying or the account,
 * and on the counter page below 1024px, where it would push the ring's controls
 * under the fold (globals.css, section 7).
 */
export default function PromoBar() {
  return (
    <div className="promo-bar" lang="en" role="region" aria-label="Premium offer">
      <div className="promo-inner">
        <span className="promo-badge">Lifetime</span>
        <p>
          <span className="promo-long">Keep your practice safe on every device, with no ads — </span>
          <strong>Premium {CURRENT_PLAN.display} once</strong>
          <span className="promo-long">, no subscription</span>
        </p>
        <Link href="/premium/" className="promo-cta" prefetch={false}>
          Get Premium <span aria-hidden="true">→</span>
        </Link>
      </div>
      <button type="button" className="promo-close" aria-label="Close offer" data-promo-close="">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
