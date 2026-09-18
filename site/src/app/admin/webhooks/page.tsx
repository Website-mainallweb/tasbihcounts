import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/admin";
import { listWebhooks } from "@/lib/admin/db";
import { count, when } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Webhooks" };

const PER_PAGE = 100;

type Props = { searchParams: Promise<{ page?: string }> };

/**
 * Every webhook delivery Razorpay has made (docs/ADMIN.md §3.5).
 *
 * The table holds one row per event id, and the id is the primary key — which is
 * the deduplication. A second delivery of the same event collides and is
 * discarded, so a payment cannot be applied twice and Premium cannot be extended
 * twice, no matter how many times Razorpay retries.
 *
 * There is no replay button here, deliberately. Replaying a stored event would
 * mean trusting our copy of what Razorpay said; re-running the purchase instead
 * asks Razorpay again, which is both safer and the thing support actually wants.
 * It lives on the purchase page.
 */
export default async function WebhooksPage({ searchParams }: Props) {
  await requireAdmin();
  const page = Math.max(1, Number((await searchParams).page) || 1);

  const { rows, total } = await listWebhooks(PER_PAGE, (page - 1) * PER_PAGE);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <>
      <div className="wrap">
        <p className="eyebrow">{count(total)} delivered</p>
        <h1>Webhook deliveries</h1>
        <p className="lede">
          One row per event id. A repeat delivery of the same event collides with its own primary
          key and is discarded — which is why a retried webhook cannot pay for anything twice.
        </p>

        {rows.length === 0 ? (
          <p className="note">
            Nothing yet. Either no payment has been made, or the webhook is not configured — check
            its URL and secret in the Razorpay dashboard.
          </p>
        ) : (
          <div className="scroll">
            <table>
              <caption className="sr-only">
                Webhook deliveries, newest first. Page {page} of {pages}.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">Type</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Event id</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.event_id}>
                    <td>{when(w.received_at)}</td>
                    <td>{w.event_type}</td>
                    <td>{w.mode}</td>
                    <td>{w.event_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <nav className="pager" aria-label="Pages">
            {page > 1 && <Link href={`/admin/webhooks/?page=${page - 1}`}>← Previous</Link>}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages && <Link href={`/admin/webhooks/?page=${page + 1}`}>Next →</Link>}
          </nav>
        )}
      </div>
    </>
  );
}
