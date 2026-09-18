import type { Metadata } from "next";
import Link from "next/link";

import BuyPanel from "@/components/BuyPanel";
import { CURRENT_PLAN } from "@/lib/payments/plans";
import { JsonLdScript, jsonLd, pageMetadata } from "@/lib/seo";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = pageMetadata("premium");

/**
 * The one thing for sale. Prerendered: the price and the copy are the same for
 * everyone, and the buy panel is the only part that runs in the browser.
 *
 * No ads here. A page that asks for money should not also be selling someone
 * else's attention.
 */
export default function PremiumPage() {
  return (
    <>
      <JsonLdScript data={jsonLd("premium", "Premium")} />
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap">
        <section className="premium">
          <div className="premium-copy">
            <p className="eyebrow">Premium</p>
            <h1>Bhakti Nam Jap Premium</h1>
            <p className="premium-lead">
              One payment of {CURRENT_PLAN.display}, for life. No subscription, no renewal, nothing to cancel.
            </p>
            {/* #08: on a phone the card is the last thing on the page. */}
            <a className="btn premium-jump" href="#buy">
              Get Premium · {CURRENT_PLAN.display}
            </a>

            <h2>What you get</h2>
            <ul className="premium-list">
              <li>
                <strong>No ads.</strong> The whole site, on every device you log in on.
              </li>
              <li>
                <strong>Your practice on all your devices.</strong> Counts, malas, streak and history sync, so a
                phone and a laptop add up to one practice.
              </li>
              <li>
                <strong>Safe if a device is lost.</strong> Your history is kept in your account, not only in one
                browser.
              </li>
              <li>
                <strong>Reminders.</strong> A gentle nudge at the time you choose, only on days your practice is still waiting.
              </li>
            </ul>

            <h2>What stays free</h2>
            <p>
              The counter, the library, streaks, stats and the backup file stay free for everyone, with no
              account. Premium is for those who want it on every device and without ads.
            </p>

            <h2>How it works</h2>
            <ol className="premium-steps">
              <li>Enter your email and pay with Razorpay — UPI, card or net banking.</li>
              <li>Your account is created with that email as soon as the payment is confirmed.</li>
              <li>
                <Link href="/login/">Log in</Link> with the same email, or the Google account that has it.
              </li>
            </ol>

            <p className="premium-fine">
              There is no free trial, so please read the above before paying. Refunds are given only for a
              technical payment problem — see the <Link href="/refund-policy/">Refund &amp; Cancellation Policy</Link>{" "}
              and the <Link href="/terms/">Terms of Service</Link>. Questions:{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
          </div>

          <div className="premium-buy" id="buy">
            <BuyPanel price={CURRENT_PLAN.display} supportEmail={SUPPORT_EMAIL} />
          </div>
        </section>
      </div>
    </>
  );
}
