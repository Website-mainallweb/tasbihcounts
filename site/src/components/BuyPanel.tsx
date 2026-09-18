"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { readPremiumFlag, subscribePremiumFlag, writePremiumFlag } from "@/lib/premium-flag";

type Props = { price: string; supportEmail: string };

type Phase = "idle" | "creating" | "checkout" | "confirming" | "done" | "failed";

type Outcome = { state: string; active: boolean; waiting: boolean };

type RazorpayResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", cb: (r: { error?: { description?: string } }) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const noSubscribe = () => () => {};

const PENDING_KEY = "njc.pendingOrder";
const POLL_EVERY_MS = 3000;
const POLL_FOR_MS = 3 * 60 * 1000;

/** Checkout's script, loaded only when someone decides to pay. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve() : reject(new Error("checkout unavailable")));
    s.onerror = () => reject(new Error("checkout unavailable"));
    document.head.appendChild(s);
  });
}

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

function remember(orderId: string, email: string) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ orderId, email, at: Date.now() }));
  } catch {
    // Storage refused; resuming after a reload is a convenience, not a need.
  }
}

function forget() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {}
}

/**
 * The purchase itself.
 *
 * Nothing here decides who gets Premium. The browser starts an order, hands the
 * payment to Razorpay's Checkout, and then asks the server where the purchase
 * has got to; the server believes only Razorpay's API. If the page is reloaded
 * mid-way, it picks the waiting up again from the order it remembered.
 */
export default function BuyPanel({ price, supportEmail }: Props) {
  const [email, setEmail] = useState("");
  const [accept, setAccept] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [paidEmail, setPaidEmail] = useState("");
  // The email already holds Premium: the alert then offers sign-in, not payment.
  const [owned, setOwned] = useState(false);
  // /premium/ is prerendered, so its form is on screen before React is. Anything
  // typed then would sit in the DOM while state stayed empty, and Pay would never
  // enable. The fields stay locked until the page is live — a moment, on any device.
  const ready = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const polling = useRef(false);
  /* #04: a buyer coming back to this page was shown the price and the form again.
     The cached flag only decides what to show — the order route still refuses an
     email that already has Premium. "For another email" keeps gifting possible. */
  // Subscribed (B02): the header learns the status after the page has painted.
  const hasPremium = useSyncExternalStore(subscribePremiumFlag, readPremiumFlag, () => false);
  const [buyAnyway, setBuyAnyway] = useState(false);

  async function waitForActivation(orderId: string, forEmail: string) {
    if (polling.current) return;
    polling.current = true;
    setPaidEmail(forEmail);
    setPhase("confirming");
    const stopAt = Date.now() + POLL_FOR_MS;
    try {
      while (Date.now() < stopAt) {
        // A dropped request is not an answer: the payment may well have gone
        // through, so a blip must not end the wait — keep asking until the
        // deadline. The webhook is finishing the purchase on the server either way.
        let ok = false;
        let data: Outcome | undefined;
        try {
          ({ ok, data } = await post<Outcome>("/api/checkout/status/", { orderId }));
        } catch {
          ok = false;
        }
        if (ok && data?.active) {
          forget();
          writePremiumFlag(true);
          setPhase("done");
          return;
        }
        if (ok && data && !data.waiting) break; // final, and not active
        await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      }
      setPhase("failed");
      setMessage(
        `We have not seen the payment arrive yet. If money left your account, Premium will activate by itself within a few minutes — or write to ${supportEmail} with your payment ID.`,
      );
    } finally {
      polling.current = false;
    }
  }

  useEffect(() => {
    try {
      const pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");
      if (pending?.orderId && Date.now() - pending.at < 24 * 60 * 60 * 1000) {
        void waitForActivation(pending.orderId, pending.email ?? "");
      }
    } catch {}
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setOwned(false);
    setPhase("creating");

    const normalised = email.trim().toLowerCase();
    // Checkout's script loads alongside the order, but the order's answer is read
    // first: "this email already has Premium" matters more than a blocked script,
    // and must not be hidden behind one.
    const checkoutReady = loadCheckout().then(
      () => true,
      () => false,
    );
    let order: Awaited<ReturnType<typeof post<{ orderId?: string; keyId?: string; amount?: number; currency?: string; error?: string }>>>;
    try {
      order = await post<{ orderId?: string; keyId?: string; amount?: number; currency?: string; error?: string }>(
        "/api/checkout/order/",
        { email: normalised, accept },
      );
    } catch {
      // The order request itself never arrived. Saying Razorpay failed here sent
      // people looking at the wrong thing.
      setPhase("idle");
      setMessage("We could not reach our payment server. Please check your connection and try again.");
      return;
    }
    try {

      if (!order.ok || !order.data.orderId) {
        setPhase("idle");
        setOwned(order.status === 409);
        setMessage(
          order.status === 409
            ? "This email already has Premium, for life. There is nothing to pay — log in with it on this device."
            : order.status === 429
            ? "Several payments were started with this email in the last hour. Please wait a little and try again."
            : order.status === 400
              ? "Please check the email address and tick the agreement."
              : "We could not start the payment. Please try again in a moment.",
        );
        return;
      }

      if (!(await checkoutReady)) throw new Error("checkout unavailable");

      const { orderId, keyId, amount, currency } = order.data;
      remember(orderId, normalised);
      setPhase("checkout");

      const checkout = new window.Razorpay!({
        key: keyId,
        order_id: orderId,
        amount,
        currency,
        name: "Bhakti Nam Jap",
        description: "Premium — lifetime",
        prefill: { email: normalised },
        readonly: { email: true },
        theme: { color: "#b0561d" },
        handler: async (response: RazorpayResponse) => {
          setPhase("confirming");
          setPaidEmail(normalised);
          try {
            const verified = await post<Outcome>("/api/checkout/verify/", response);
            if (verified.ok && verified.data.active) {
              forget();
              writePremiumFlag(true);
              setPhase("done");
              return;
            }
          } catch {
            // The verify request dropped after the money was taken. Fall through
            // to polling rather than hang on the spinner — the payment stands and
            // the webhook activates it; the poll (or a later reload) catches up.
          }
          await waitForActivation(orderId, normalised);
        },
        modal: {
          ondismiss: () => {
            // Closed without paying. The order stays unpaid and grants nothing.
            setPhase((p) => {
              /* B39: and it is not remembered, or coming back here within a day
                 waited three minutes and then warned that the payment was missing. */
              if (p === "checkout") forget();
              return p === "checkout" ? "idle" : p;
            });
          },
        },
      });
      checkout.on("payment.failed", (r) => {
        setPhase("idle");
        setMessage(
          `The payment did not go through${r.error?.description ? `: ${r.error.description}` : ""}. If money left your account, your bank returns it automatically.`,
        );
      });
      checkout.open();
    } catch {
      setPhase("idle");
      setMessage("Razorpay's checkout could not be loaded. Please check your connection and try again.");
    }
  }

  if (phase === "done") {
    return (
      <div className="buy-card buy-done" role="status">
        <h2>Premium is active</h2>
        <p>
          Thank you. Your account is ready for <strong>{paidEmail}</strong>. Log in with that email — or the
          Google account that has it — on each device you use.
        </p>
        <Link className="btn" href="/login/">
          Log in
        </Link>
      </div>
    );
  }

  if (phase === "confirming") {
    return (
      <div className="buy-card" role="status" aria-live="polite">
        <h2>Confirming your payment…</h2>
        <p>This usually takes a few seconds. Please keep this page open.</p>
        <div className="buy-spinner" aria-hidden="true" />
      </div>
    );
  }

  if (hasPremium && !buyAnyway && phase === "idle") {
    return (
      <div className="buy-card buy-done" role="status">
        <h2>You have Premium — for life</h2>
        <p>There is nothing more to pay on this account. Log in with it on each device you use.</p>
        <Link className="btn" href="/">
          Open the counter
        </Link>
        <p className="buy-hint">
          <Link href="/account/">Your account</Link> ·{" "}
          <button type="button" className="auth-link" onClick={() => setBuyAnyway(true)}>
            Buy Premium for a different email
          </button>
        </p>
      </div>
    );
  }

  const busy = !ready || phase === "creating" || phase === "checkout";
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && accept;

  return (
    <form className="buy-card" onSubmit={buy} noValidate data-ready={ready ? "" : undefined}>
      <p className="buy-price">
        <span>{price}</span> once, for life
      </p>

      {message && (
        <p className="auth-alert" role="alert">
          {message}
        </p>
      )}
      {owned && (
        <Link className="btn buy-owned" href="/login/">
          Log in
        </Link>
      )}

      <label htmlFor="buy-email">Your email</label>
      <input
        id="buy-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        maxLength={320}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          // A different address may not own Premium; offer payment again.
          setOwned(false);
        }}
        placeholder="you@example.com"
        disabled={busy}
      />
      <p className="buy-hint">
        Your account is created with this email. Use the same address — or the Google account that has it — to
        log in afterwards.
      </p>

      <label className="buy-accept">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} disabled={busy} />
        <span>
          I agree to the <Link href="/terms/">Terms of Service</Link> and the{" "}
          <Link href="/refund-policy/">Refund &amp; Cancellation Policy</Link>.
        </span>
      </label>

      {/* Not while the alert says this email already owns Premium: paying again
          could only fail, and the Log in link above is the way forward. */}
      <button
        type="submit"
        className="auth-submit"
        disabled={!valid || busy || owned}
        aria-describedby={!valid && !busy && !owned ? "buy-missing" : undefined}
      >
        {phase === "creating" ? "Starting…" : phase === "checkout" ? "Complete the payment in Razorpay" : `Pay ${price}`}
      </button>
      {/* #09: the pale button used to give no reason. */}
      {!valid && !busy && !owned && (
        <p className="buy-hint" id="buy-missing">
          {!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
            ? accept
              ? "Enter your email address to continue."
              : "Enter your email address and tick the agreement to continue."
            : "Tick the agreement to continue."}
        </p>
      )}

      <p className="buy-secure">Payments are handled by Razorpay. We never see your card, UPI or bank details.</p>
    </form>
  );
}
