"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";

import {
  ACCOUNT_PATH,
  LOGIN_MESSAGES,
  loginErrorFrom,
  safeNext,
  type LoginError,
} from "@/lib/auth-redirect";
import { PREMIUM_CHECKED_KEY } from "@/lib/premium-flag";
import { browserSupabase } from "@/lib/supabase/browser";

/** Signed in: forget the last Premium check so the header asks again for this account (B01). */
function finish(target: string) {
  try {
    sessionStorage.removeItem(PREMIUM_CHECKED_KEY);
  } catch {}
  window.location.replace(target);
}

type Mode = "password" | "email" | "forgot";

type Props = {
  initialError: LoginError | null;
  supportEmail: string;
  /** Where a successful sign-in lands. Always reduced to a path on this site. */
  next?: string;
  initialMode?: Mode;
  /** Shown under the form: how to get an account (there is no signup). */
  premiumAction?: ReactNode;
  /**
   * The Google sign-in kill switch (docs/ADMIN.md §3.8), resolved by the page.
   * Defaults to true so a caller that does not know about it — a test, a future
   * page — gets the normal form rather than a silently crippled one.
   */
  googleOn?: boolean;
};

/** The email carries a code only once a custom SMTP provider is configured. */
const EMAIL_HAS_CODE = process.env.NEXT_PUBLIC_EMAIL_CODE === "1";

/**
 * Sign-in for Premium buyers: a password, Google, or a one-time code by email.
 *
 * Signups are off in Supabase and every call here also says
 * shouldCreateUser: false (tests/unit/auth-config.test.ts enforces it), so no
 * path can create an account. Accounts are made only by a completed payment.
 *
 * A password is chosen through "Forgot password?": the email carries a link to
 * /auth/reset/, where the new one is set. There is no password form on the
 * account page any more.
 *
 * The password goes to /api/auth/password/, not straight to Supabase, so every
 * attempt can be counted per address and per network (lib/auth-throttle.ts).
 */
export default function LoginForm({ initialError, supportEmail, next, initialMode = "password", premiumAction, googleOn = true }: Props) {
  const id = useId();
  const target = safeNext(next ?? ACCOUNT_PATH);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoginError | null>(initialError);
  const [mode, setMode] = useState<Mode>(initialMode);
  /* "sent" after asking for mail; "code" when typing a code that already came. */
  const [step, setStep] = useState<"form" | "sent" | "code">("form");
  const [code, setCode] = useState("");

  /* Supabase appends its own "#error=…&error_description=…" to the address when
     it refuses a sign-in. The page already says what happened in plain words
     (?error=), so the raw fragment is dropped rather than left in the address
     bar to be bookmarked or pasted into a support email. */
  useEffect(() => {
    if (/(^#|&)error(_code|_description)?=/.test(window.location.hash)) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const address = email.trim().toLowerCase();

  const go = (m: Mode) => {
    setMode(m);
    setStep("form");
    setError(null);
    setCode("");
  };

  async function withGoogle() {
    setError(null);
    try {
      const { error: err } = await browserSupabase().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/auth/callback/?next=" + encodeURIComponent(target),
          queryParams: { prompt: "select_account" },
        },
      });
      if (err) setError(loginErrorFrom(err.message, err.code));
    } catch {
      setError("failed");
    }
  }

  async function post(path: string, body: object): Promise<Response | null> {
    try {
      return await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return null;
    }
  }

  async function withPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const res = await post("/api/auth/password/", { email: address, password });
    if (res?.ok) {
      finish(target);
      return;
    }
    setBusy(false);
    setError(!res ? "failed" : res.status === 429 ? "rate_limited" : "bad_credentials");
  }

  /*
   * Through our own routes, not the browser's Supabase client: a request that
   * leaves the browser cannot be counted, and asking for mail in a loop would
   * burn the project's hourly allowance for everybody. Both answer the same for
   * an address with no account.
   */
  async function withEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const res = await post("/api/auth/otp/", { email: address, next: target });
    setBusy(false);
    if (!res) return setError("failed");
    if (res.status === 429) return setError("rate_limited");
    setStep("sent");
  }

  async function withForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const res = await post("/api/auth/recover/", { email: address });
    setBusy(false);
    if (!res) return setError("failed");
    if (res.status === 429) return setError("rate_limited");
    setStep("sent");
  }

  /** The sign-in code from the email (a magic-link mail verifies as "email"). */
  async function withCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // The session client, so the session lands in cookies the server can read.
      const { error: err } = await browserSupabase().auth.verifyOtp({
        email: address,
        token: code.trim(),
        type: "email",
      });
      if (!err) {
        finish(target);
        return;
      }
      setError(loginErrorFrom(err.message, err.code));
    } catch {
      setError("failed");
    }
    setBusy(false);
  }

  const emailField = (
    <div className="field">
      <label htmlFor={`${id}-email`}>Email address</label>
      <input
        id={`${id}-email`}
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        maxLength={320}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="The email you paid with"
      />
    </div>
  );

  const titles: Record<Mode, [string, string]> = {
    password: ["Welcome back", "Log in with the email you used to buy Premium."],
    email: ["Log in by email", "We email you a one-time code — no password needed."],
    forgot: ["Reset your password", "We email you a link. Open it to choose a new password."],
  };
  const [title, lead] = titles[mode];

  return (
    <div className="auth-card" data-mode={mode}>
      <div className="auth-card-head">
        <h2>{step === "sent" ? "Check your email" : title}</h2>
        {step !== "sent" && <p>{lead}</p>}
      </div>

      {error && (
        <p className="auth-alert" role="alert">
          {LOGIN_MESSAGES[error]}
        </p>
      )}

      {step === "sent" ? (
        <div className="auth-sent" role="status">
          <span className="auth-sent-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16v12H4zM4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </span>
          {mode === "forgot" ? (
            <p>
              If <strong>{address}</strong> has an account, a link to choose a new password is on its way. It works
              once and expires in 15 minutes. Open it, then press <strong>Set new password</strong> on the page it
              opens.
            </p>
          ) : (
            <p>
              We sent {EMAIL_HAS_CODE ? "a code and a sign-in link" : "a sign-in link"} to <strong>{address}</strong>.
              Each works once and expires in 15 minutes.
            </p>
          )}
          {mode === "email" && EMAIL_HAS_CODE && (
            <button type="button" className="btn btn-primary btn-block" onClick={() => setStep("code")}>
              Enter the code
            </button>
          )}
          <p className="auth-foot">
            Nothing arrived? Check spam, or{" "}
            <button type="button" className="link-btn" onClick={() => setStep("form")}>
              try again
            </button>
            .
          </p>
          <button type="button" className="link-btn" onClick={() => go("password")}>
            ← Back to log in
          </button>
        </div>
      ) : step === "code" ? (
        <form className="auth-form" onSubmit={withCode}>
          {emailField}
          <div className="field">
            <label htmlFor={`${id}-code`}>6-digit code</label>
            <input
              id={`${id}-code`}
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length < 6 || !address}>
            {busy ? "Checking…" : "Log in"}
          </button>
          <button type="button" className="link-btn" onClick={() => go("email")}>
            ← Back
          </button>
        </form>
      ) : (
        <>
          {/* The Google sign-in kill switch (docs/ADMIN.md §3.8). With it off the
              button and its "or" divider are gone and email sign-in is the whole
              form, so nobody is offered a door that does not open. Anyone who
              made their account with Google still gets in: the reset link sets a
              password on the same address. */}
          {mode !== "forgot" && googleOn && (
            <>
              <button type="button" className="btn btn-google btn-block" onClick={withGoogle}>
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                Continue with Google
              </button>
              <div className="auth-or" aria-hidden="true">
                <span>or</span>
              </div>
            </>
          )}

          {mode === "password" ? (
            <form className="auth-form" onSubmit={withPassword}>
              {emailField}
              <div className="field">
                <div className="field-row">
                  <label htmlFor={`${id}-password`}>Password</label>
                  <button type="button" className="link-btn" onClick={() => go("forgot")}>
                    Forgot password?
                  </button>
                </div>
                <div className="input-with-action">
                  <input
                    id={`${id}-password`}
                    type={reveal ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    maxLength={200}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="input-action"
                    aria-pressed={reveal}
                    aria-label={reveal ? "Hide password" : "Show password"}
                    onClick={() => setReveal((v) => !v)}
                  >
                    {reveal ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Logging in…" : "Log in"}
              </button>
              <button type="button" className="link-btn auth-alt" onClick={() => go("email")}>
                Log in with an email code instead
              </button>
            </form>
          ) : mode === "forgot" ? (
            <form className="auth-form" onSubmit={withForgot}>
              {emailField}
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
              <p className="auth-foot">
                Never set a password? This is also how you choose your first one.
              </p>
              <button type="button" className="link-btn" onClick={() => go("password")}>
                ← Back to log in
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={withEmail}>
              {emailField}
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Sending…" : EMAIL_HAS_CODE ? "Email me a code" : "Email me a sign-in link"}
              </button>
              <p className="auth-switch">
                <button type="button" className="link-btn" onClick={() => go("password")}>
                  Use a password instead
                </button>
                {EMAIL_HAS_CODE && (
                  <button type="button" className="link-btn" onClick={() => setStep("code")}>
                    I already have a code
                  </button>
                )}
              </p>
            </form>
          )}
        </>
      )}

      {premiumAction && <div className="auth-premium-note">{premiumAction}</div>}

      <p className="auth-help">
        Trouble logging in? Write to <a href={"mailto:" + supportEmail}>{supportEmail}</a>.
      </p>
    </div>
  );
}
