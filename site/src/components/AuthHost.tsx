"use client";

import { useEffect, useState, type ComponentType } from "react";

import { AUTH_EVENT, type AuthTab } from "@/lib/auth-ui";

type DialogProps = { supportEmail: string; initialTab: AuthTab };

/**
 * Waits for the first "open the log-in popup" and only then loads the popup.
 * Until somebody asks, the page carries a few lines of JavaScript for it and
 * nothing more; after that AuthDialog listens for itself.
 *
 * If the popup cannot be fetched, a short notice says why (B41). It used to go
 * to /login/ instead, and an installed app with no connection landed on the
 * browser's own offline error page, out of the counter. Online, the notice
 * links to the page.
 */
export default function AuthHost({ supportEmail }: { supportEmail: string }) {
  const [loaded, setLoaded] = useState<{ Dialog: ComponentType<DialogProps>; tab: AuthTab } | null>(null);
  const [failed, setFailed] = useState<{ tab: AuthTab; offline: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loaded) return;
    const onOpen = (e: Event) => {
      const tab = (e as CustomEvent<AuthTab>).detail ?? "login";
      import("./AuthDialog").then(
        (m) => {
          setFailed(null);
          setLoaded({ Dialog: m.default, tab });
        },
        () => {
          setFailed({ tab, offline: !navigator.onLine });
          setAttempt((n) => n + 1); // listen again for the next try
        },
      );
    };
    window.addEventListener(AUTH_EVENT, onOpen, { once: true });
    return () => window.removeEventListener(AUTH_EVENT, onOpen);
  }, [loaded, attempt]);

  useEffect(() => {
    if (!failed) return;
    const t = window.setTimeout(() => setFailed(null), 6000);
    return () => window.clearTimeout(t);
  }, [failed]);

  if (loaded) return <loaded.Dialog supportEmail={supportEmail} initialTab={loaded.tab} />;
  if (!failed) return null;
  return (
    <div className="auth-offline" role="alert" lang="en">
      {failed.offline ? (
        <>You are offline. Logging in needs an internet connection — your counting is saved on this device.</>
      ) : (
        <>
          Could not open the form.{" "}
          <a href={failed.tab === "premium" ? "/premium/" : "/login/"}>
            {failed.tab === "premium" ? "Open the Premium page" : "Open the log-in page"}
          </a>
          .
        </>
      )}
    </div>
  );
}
