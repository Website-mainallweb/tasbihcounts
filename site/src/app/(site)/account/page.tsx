import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import LastSynced from "@/components/LastSynced";
import PasswordEmailButton from "@/components/PasswordEmailButton";
import PremiumFlag from "@/components/PremiumFlag";
import ReminderSettings from "@/components/ReminderSettings";
import SignOutButton from "@/components/SignOutButton";
import { ACCOUNT_PATH, LOGIN_PATH } from "@/lib/auth-redirect";
import { requireUser, Unauthorized, type Authed } from "@/lib/dal";
import { CURRENT_PLAN } from "@/lib/payments/plans";
import { appPageMetadata } from "@/lib/seo";
import { SUPPORT_EMAIL } from "@/lib/site";

/**
 * The signed-in user's own account. Rendered per request: it shows one person's
 * data, so it is never prerendered and never cached.
 *
 * It verifies the session itself with requireUser() — proxy.ts only refreshes
 * cookies — and asks the database whether Premium is active rather than trusting
 * anything the browser holds. Signed out, it sends the visitor to log in and
 * back here afterwards.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = appPageMetadata("Your account", "Your Tasbih Counts Premium account.");

/* Supabase calls the email identity "email" whether the person signs in with a
   link, a code or a password — all three are the same identity. */
const PROVIDER_NAMES: Record<string, string> = { google: "Google", email: "Email" };

export default async function AccountPage() {
  let authed: Authed;
  try {
    authed = await requireUser();
  } catch (err) {
    if (err instanceof Unauthorized) redirect(`${LOGIN_PATH}?next=${ACCOUNT_PATH}`);
    throw err;
  }

  const { user, supabase } = authed;
  const { data: premium } = await supabase.rpc("my_premium");
  const active = premium === true;
  const methods = [...new Set((user.identities ?? []).map((i) => PROVIDER_NAMES[i.provider] ?? i.provider))];
  const email = user.email ?? "";

  return (
    <>
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap page">
        <PremiumFlag active={active} />

        <header className="page-head">
          <p className="eyebrow">Account</p>
          <h1>Your account</h1>
          <p>Your plan, reminders, sign-in and data — all in one place.</p>
        </header>

        <div className="account-layout">
          <aside className="panel-card account-profile" aria-label="Profile">
            <div className="account-id">
              <span className="avatar" aria-hidden="true">
                {email.charAt(0) || "?"}
              </span>
              <div>
                <b data-testid="account-email">{email}</b>
                <small>{methods.length > 0 ? `Logs in with ${methods.join(" · ")}` : "Premium account"}</small>
              </div>
            </div>
            <span className="badge" data-tone={active ? "good" : undefined}>
              {active ? "★ Premium · lifetime" : "No Premium on this account"}
            </span>
            <div className="account-actions">
              <Link className="btn btn-primary" href="/">
                Open the counter
              </Link>
              <SignOutButton />
            </div>
            <p className="account-note">
              Signing out removes your practice from this device — it stays safe in your account, and signing in again
              brings it back. If this device had its own practice before you signed in, that comes back.
            </p>
          </aside>

          <div className="account-main">
            <section className="panel-card" aria-labelledby="plan-title">
              <header>
                <h2 id="plan-title">Plan</h2>
              </header>
              <dl className="account-facts">
                <div>
                  <dt>Premium</dt>
                  <dd data-testid="account-premium" data-active={active}>
                    {active ? "Active — lifetime" : "Not active on this account"}
                  </dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{email}</dd>
                </div>
                {/* Read from this device, not from the server: see LastSynced. */}
                <LastSynced premium={active} />
              </dl>
              {!active && (
                <>
                  <p className="account-note">
                    Premium adds sync across your devices, reminders and an ad-free page — {CURRENT_PLAN.display} once,
                    for life. Buy it with <strong>this same email</strong> and it appears here.
                  </p>
                  <div className="account-actions">
                    <Link className="btn btn-primary" href="/premium/">
                      Get Premium
                    </Link>
                  </div>
                  <p className="account-note">
                    Already paid and Premium is not showing? Write to{" "}
                    <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with your Razorpay payment ID and we will
                    sort it out.
                  </p>
                </>
              )}
            </section>

            {active && (
              <ReminderSettings />
            )}

            <section className="panel-card" aria-labelledby="password-title">
              <header>
                <h2 id="password-title">Password</h2>
              </header>
              <p className="account-note">
                To set a password, or change the one you have, we email a link to {email}. Open it and choose the new
                password there. You can always log in with Google or an email code as well.
              </p>
              <PasswordEmailButton email={email} />
            </section>

            <section className="panel-card" aria-labelledby="data-title">
              <header>
                <h2 id="data-title">Your data</h2>
              </header>
              <p className="account-note">
                Your practice syncs on its own whenever the counter is open. A copy of your own is one tap away too:{" "}
                <Link href="/#settings">Settings → Back up</Link> on the counter.
              </p>
              {/* #21: deletion used to mean composing an email from scratch. */}
              <p className="account-note">
                To delete your account and its synced data,{" "}
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Delete my account")}&body=${encodeURIComponent(
                    `Please delete my Tasbih Counts account and its synced data.\n\nAccount email: ${email}`,
                  )}`}
                >
                  request account deletion
                </a>{" "}
                — it opens an email to {SUPPORT_EMAIL}; send it from this address. See the{" "}
                <Link href="/privacy-policy/">Privacy Policy</Link>.
              </p>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
