"use client";

import { useState } from "react";

/**
 * Set or change the password from the account page — by email, not by a form.
 * It sends this account's own reset link (the same route as "Forgot password?"),
 * and the new password is chosen on the page the link opens. Knowing a signed-in
 * browser is not enough to change the password: the mailbox is needed too.
 */
export default function PasswordEmailButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "limited" | "failed">("idle");

  async function send() {
    setState("busy");
    try {
      const res = await fetch("/api/auth/recover/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setState(res.status === 429 ? "limited" : res.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="account-actions">
      <button type="button" className="btn btn-outline" onClick={send} disabled={state === "busy" || state === "sent"}>
        {state === "busy" ? "Sending…" : state === "sent" ? "Link sent" : "Email me a password link"}
      </button>
      {state === "sent" && (
        <p className="auth-notice" role="status">
          Check {email}. The link works once and expires in 15 minutes.
        </p>
      )}
      {state === "limited" && (
        <p className="auth-alert" role="alert">
          A link was sent recently. Please wait a while before asking again.
        </p>
      )}
      {state === "failed" && (
        <p className="auth-alert" role="alert">
          That did not work. Please check your connection and try again.
        </p>
      )}
    </div>
  );
}
