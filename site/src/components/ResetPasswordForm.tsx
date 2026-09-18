"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";

import { ACCOUNT_PATH } from "@/lib/auth-redirect";
import { PASSWORD_MESSAGES, PASSWORD_MIN, passwordProblem, type ResetError } from "@/lib/password-rules";

/* Read once per page load: the address bar is wiped straight after. */
let captured: string | null | undefined;

const noSubscribe = () => () => {};

function readToken(): string | null {
  if (captured === undefined) {
    /* The head script (app/layout.tsx) has usually moved it out of the address
       bar already; a client-side navigation here has not run that script. */
    const holder = window as { __njcReset?: string };
    const params = new URLSearchParams(holder.__njcReset ?? window.location.search);
    const hash = params.get("token_hash");
    captured = hash && params.get("type") === "recovery" ? hash : null;
    delete holder.__njcReset;
    if (window.location.search) history.replaceState(null, "", window.location.pathname);
  }
  return captured;
}

/**
 * "Choose a new password", reached from the reset email.
 *
 * Opening the page spends nothing. The token is taken out of the address bar at
 * once (so it cannot be bookmarked, shared or sent onward as a referrer) and kept
 * in memory until the person presses Set new password — only then does the
 * server verify it. A mail scanner that opens the link sees a form and leaves.
 */
export default function ResetPasswordForm() {
  const token = useSyncExternalStore(noSubscribe, readToken, () => undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ResetError | null>(null);
  const [done, setDone] = useState(false);
  /* After a refusal that already spent the token, retry on the recovery session. */
  const [spent, setSpent] = useState(false);


  const local = password ? passwordProblem(password) : null;
  const rules = [
    { ok: password.length >= PASSWORD_MIN, text: `At least ${PASSWORD_MIN} characters` },
    { ok: /[A-Za-z]/.test(password) && /[0-9]/.test(password), text: "A letter and a number" },
    { ok: password.length > 0 && password === confirm, text: "Both fields match" },
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (local) return setError(local);
    if (password !== confirm) return setError("mismatch");

    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spent ? { password } : { token_hash: token, password }),
      });
      if (res.ok) {
        setDone(true);
        window.setTimeout(() => window.location.replace(ACCOUNT_PATH), 1600);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: ResetError; verified?: boolean };
      const code = data.error && data.error in PASSWORD_MESSAGES ? data.error : "failed";
      /* The token was verified before this refusal: the session carries the retry
         (B73: any such refusal, a passing failure included — the server says). */
      if (data.verified) setSpent(true);
      setError(res.status === 429 ? "rate_limited" : code);
    } catch {
      setError("failed");
    }
    setBusy(false);
  }

  if (token === undefined) {
    return (
      <div className="auth-card" aria-busy="true">
        <p className="auth-loading">
          <span className="spinner" aria-hidden="true" /> Loading…
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-card">
        <div className="auth-sent" role="status">
          <span className="auth-sent-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M6 12.5l4 4 8-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h1 className="auth-done-title">Password updated</h1>
          <p>You are logged in. Taking you to your account…</p>
          <Link className="btn btn-primary" href={ACCOUNT_PATH}>
            Go to my account
          </Link>
        </div>
      </div>
    );
  }

  if (!token || (error === "link_expired" && !spent)) {
    return (
      <div className="auth-card">
        <div className="auth-card-head">
          <h1>This link cannot be used</h1>
          <p>{PASSWORD_MESSAGES.link_expired}</p>
        </div>
        <Link className="btn btn-primary btn-block" href="/login/?mode=forgot">
          Send me a new link
        </Link>
        <Link className="btn btn-outline btn-block" href="/login/">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form className="auth-card" onSubmit={submit} noValidate>
      <div className="auth-card-head">
        <h1>Choose a new password</h1>
        <p>Pick something you will remember. It works on every device you log in on.</p>
      </div>

      {error && (
        <p className="auth-alert" role="alert">
          {PASSWORD_MESSAGES[error]}
        </p>
      )}

      <div className="field">
        <label htmlFor="reset-new">New password</label>
        <div className="input-with-action">
          <input
            id="reset-new"
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN}
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="reset-rules"
            aria-invalid={password && local ? true : undefined}
          />
          <button
            type="button"
            className="input-action"
            aria-pressed={reveal}
            aria-label={reveal ? "Hide passwords" : "Show passwords"}
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="reset-confirm">Type it again</label>
        <input
          id="reset-confirm"
          type={reveal ? "text" : "password"}
          autoComplete="new-password"
          required
          maxLength={200}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={confirm && confirm !== password ? true : undefined}
        />
      </div>

      <ul className="pw-rules" id="reset-rules">
        {rules.map((r) => (
          <li key={r.text} data-ok={r.ok || undefined}>
            {r.text}
          </li>
        ))}
      </ul>

      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !rules.every((r) => r.ok)}>
        {busy ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
