"use client";

import { useState } from "react";

import { signOut } from "@/app/(site)/account/actions";
import { flushForSignOut, leaveDevice } from "@/lib/counter/account-link";
import { dayKey } from "@/lib/counter/day";
import { localStore } from "@/lib/counter/storage";
import { browserAccessToken } from "@/lib/counter/sync-client";
import { PREMIUM_CHECKED_KEY, writePremiumFlag } from "@/lib/premium-flag";
import { forgetThisDevice } from "@/lib/push/push-client";

/**
 * Sign out, and leave nothing of the account on this device for the next person:
 * the cached Premium status, this browser's reminder registration, and the
 * account's practice (lib/counter/account-link.ts). The device gets back the
 * practice it had before signing in, if it had one set aside.
 *
 * Unsent chants go up first. If they cannot — offline — the user is told and
 * chooses, because signing out would otherwise lose them silently.
 *
 * The registration is removed while the session can still authorise it — the
 * server action ends that session. Without JavaScript the form still posts and
 * signs out; the practice then simply stays on the device.
 */
export default function SignOutButton() {
  const [state, setState] = useState<"idle" | "busy" | "unsent">("idle");

  async function run(evenIfUnsent: boolean) {
    setState("busy");
    const store = localStore();
    if (!evenIfUnsent) {
      const sent = await flushForSignOut(store, await browserAccessToken(), (url, init) => fetch(url, init));
      if (!sent) {
        setState("unsent");
        return;
      }
    }
    leaveDevice(store, dayKey());
    writePremiumFlag(false);
    try {
      sessionStorage.removeItem(PREMIUM_CHECKED_KEY);
    } catch {}
    await forgetThisDevice();
    await signOut();
  }

  return (
    <form
      className="account-signout-form"
      action={signOut}
      onSubmit={(event) => {
        event.preventDefault();
        void run(false);
      }}
    >
      <button type="submit" className="account-signout" disabled={state === "busy"}>
        {state === "busy" ? "Signing out…" : state === "unsent" ? "Try again" : "Sign out"}
      </button>
      {state === "unsent" && (
        <>
          <button type="button" className="account-signout" onClick={() => void run(true)}>
            Sign out anyway
          </button>
          <p className="auth-alert" role="alert">
            Some counts from this device have not reached your account yet. Check your internet connection
            and try again — signing out now would lose them.
          </p>
        </>
      )}
    </form>
  );
}
