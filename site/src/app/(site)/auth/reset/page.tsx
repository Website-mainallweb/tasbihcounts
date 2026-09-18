import type { Metadata } from "next";

import ResetPasswordForm from "@/components/ResetPasswordForm";
import { appPageMetadata } from "@/lib/seo";

/**
 * Where the "reset your password" email lands. Prerendered and inert: the form
 * reads the token in the browser and spends it only on the button press. Noindex,
 * like every sign-in page.
 */
export const metadata: Metadata = {
  ...appPageMetadata("Choose a new password", "Set a new password for your Tasbih Counts account."),
  referrer: "no-referrer",
};

export default function ResetPage() {
  return (
    <>
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap">
        <section className="auth-page auth-page-narrow">
          <ResetPasswordForm />
        </section>
      </div>
    </>
  );
}
