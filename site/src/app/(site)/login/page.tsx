import type { Metadata } from "next";
import { flagOn } from "@/lib/flags";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import LoginForm from "@/components/LoginForm";
import { ACCOUNT_PATH, isLoginError, safeNext } from "@/lib/auth-redirect";
import { requireUser } from "@/lib/dal";
import { CURRENT_PLAN } from "@/lib/payments/plans";
import { appPageMetadata } from "@/lib/seo";
import { SUPPORT_EMAIL } from "@/lib/site";

/**
 * Log in, as a page: for a direct visit, an email link that failed, or a browser
 * without JavaScript. Everywhere else the header opens the same form in a popup.
 *
 * Accounts exist only for people who bought Premium, so there is no register
 * form — the second column says how an account is made instead.
 *
 * Noindex — there is nothing here for a search engine, and a sign-in page in
 * results invites people to look for a signup that does not exist.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = appPageMetadata("Log in", "Log in to your Bhakti Nam Jap Premium account.");

type Props = { searchParams: Promise<{ error?: string; next?: string; mode?: string }> };

const POINTS = [
  ["No ads", "anywhere on the site."],
  ["Every device, one practice", "— counts, malas, streak and history stay in step."],
  ["Safe if a phone is lost", "— your history lives in your account."],
  ["Gentle reminders", "at the time you choose."],
] as const;

async function signedIn(): Promise<boolean> {
  const store = await cookies();
  if (!store.getAll().some((c) => /^sb-.+-auth-token/.test(c.name))) return false;
  try {
    await requireUser();
    return true;
  } catch {
    return false;
  }
}

export default async function LoginPage({ searchParams }: Props) {
  const { error, next: rawNext, mode } = await searchParams;
  const next = safeNext(rawNext ?? ACCOUNT_PATH);

  /* Already signed in: straight on, rather than a form that would only sign the
     same person in again. The target is always a path on this site. */
  if (await signedIn()) redirect(next);

  return (
    <>
      <div className="page-glow" aria-hidden="true" />
      <div className="wrap">
        <section className="auth-page">
          <div className="auth-intro">
            <p className="eyebrow">Premium account</p>
            <h1>Log in to Bhakti Nam Jap</h1>
            <p>
              Your account was created when your Premium payment went through, with the email you paid with. Use that
              same address here, or the Google account that has it.
            </p>
            <ul className="check-list">
              {POINTS.map(([t, d]) => (
                <li key={t}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.14" />
                    <path d="M7.5 12.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>
                    <strong>{t}</strong> {d}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              Not bought Premium? The <Link href="/">counter</Link> is free and needs no account. Your practice stays on
              this device, and <strong>Settings → Back up</strong> saves a copy.
            </p>
          </div>

          <LoginForm
            initialError={isLoginError(error) ? error : null}
            supportEmail={SUPPORT_EMAIL}
            next={next}
            initialMode={mode === "forgot" ? "forgot" : mode === "email" ? "email" : "password"}
            /* The Google sign-in kill switch (docs/ADMIN.md §3.8). Resolved here,
               on the server, rather than inside the form: this page is rendered
               per request anyway, and a prop costs the counter page nothing. */
            googleOn={await flagOn("google_login")}
            premiumAction={
              <>
                No account yet? One is created when you buy Premium ({CURRENT_PLAN.display}, lifetime).{" "}
                <Link href="/premium/">Get Premium</Link>
              </>
            }
          />
        </section>
      </div>
    </>
  );
}
