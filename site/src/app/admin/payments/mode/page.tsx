import type { Metadata } from "next";
import Link from "next/link";

import { switchMode } from "./actions";
import { requireAdmin } from "@/lib/admin";
import { overview, paymentMode } from "@/lib/admin/db";
import { count, money } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Payment mode" };

type Props = { searchParams: Promise<{ m?: string }> };

/**
 * Test ⇄ live (docs/ADMIN.md §3.7).
 *
 * This was a hand-written UPDATE on a table nothing can reach through the API —
 * step three of the "going live" list in docs/DEPLOY.md, done over a database
 * console at the exact moment everything else is also changing. It is the single
 * best argument for the panel existing.
 *
 * What it actually does is narrow and total: entitlements count only in the mode
 * that is in force, so flipping this switch makes every entitlement in the other
 * mode stop working, immediately, for everyone. The page says so in those words
 * and makes the target mode be typed out.
 */
export default async function ModePage({ searchParams }: Props) {
  await requireAdmin();
  const { m } = await searchParams;
  const [mode, o] = await Promise.all([paymentMode(), overview()]);

  const other = mode === "test" ? "live" : "test";

  return (
    <>
      <div className="wrap">
        <Link className="back" href="/admin/payments/">
          ← Payments
        </Link>
        <p className="eyebrow">Currently {mode}</p>
        <h1>Payment mode</h1>

        <div aria-live="polite">{m && <p className="banner">{m}</p>}</div>

        <section className="card">
          <h2>What is counting right now</h2>
          <dl className="facts">
            <div>
              <dt>Mode</dt>
              <dd>{mode}</dd>
            </div>
            <div>
              <dt>Premium accounts</dt>
              <dd>{count(o.premium)}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>{money(o.revenue_paise)}</dd>
            </div>
          </dl>
        </section>

        <section className="card danger-zone">
          <h2>Switch to {other}</h2>
          <p className="note">
            Entitlements count only in the mode that is in force. The moment this changes, every one
            of the {count(o.premium)} account{o.premium === 1 ? "" : "s"} listed above loses Premium,
            and whatever exists in {other} mode gains it. Nothing is deleted and switching back
            restores exactly what was there.
          </p>
          <p className="note">
            Going live also means swapping <code>RAZORPAY_KEY_ID</code>,{" "}
            <code>RAZORPAY_KEY_SECRET</code> <strong>and</strong>{" "}
            <code>RAZORPAY_WEBHOOK_SECRET</code> on the site. A live webhook still holding the test
            secret refuses every real payment, silently.
          </p>

          <form action={switchMode} className="form">
            <label htmlFor="confirm">
              Type <strong>{other}</strong> to confirm
            </label>
            <input id="confirm" name="confirm" type="text" maxLength={10} required autoComplete="off" />
            <label htmlFor="mode-reason">Reason</label>
            <input id="mode-reason" name="reason" type="text" maxLength={500} required />
            <input type="hidden" name="target" value={other} />
            <button type="submit" className="danger">
              Switch to {other}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
