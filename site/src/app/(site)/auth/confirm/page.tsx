import type { Metadata } from "next";
import Link from "next/link";

import EmailLinkConfirm from "@/components/EmailLinkConfirm";
import { LOGIN_PATH } from "@/lib/auth-redirect";
import { appPageMetadata } from "@/lib/seo";

/**
 * The landing page of an email sign-in link. The session is in the address
 * fragment, which only the browser can read — see EmailLinkConfirm. Noindex, like
 * every sign-in page.
 */
export const metadata: Metadata = appPageMetadata("Logging in", "Finishing logging in to Bhakti Nam Jap Premium.");

export default function ConfirmPage() {
  return (
    <>
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap">
        <section className="auth-page auth-page-narrow">
          <div className="auth-card" role="status">
            <div className="auth-sent">
              <span className="spinner" aria-hidden="true" />
              <h1 className="auth-done-title">Logging you in…</h1>
              <p>
                One moment. If nothing happens, <Link href={LOGIN_PATH}>go back to log in</Link> and ask for a new
                link.
              </p>
            </div>
          </div>
        </section>
      </div>
      <EmailLinkConfirm />
    </>
  );
}
