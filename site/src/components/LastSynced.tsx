"use client";

import { useEffect, useState } from "react";

import { agoLabel, readSynced } from "@/lib/counter/last-sync";
import { localStore } from "@/lib/counter/storage";

/**
 * "Last synced" on the account page (UX walkthrough #21).
 *
 * The counter syncs without saying so, which is right while chanting and wrong
 * here: a sync that has silently stopped — an expired session, a phone that has
 * been offline for a week — looked exactly like one that is working. This says
 * which it is.
 *
 * A client component because the answer is on the device, not on the server: it
 * is this browser's own last round trip, so the page cannot know it while it is
 * being rendered.
 */
export default function LastSynced({ premium }: { premium: boolean }) {
  /* undefined = not read yet (the server render and the first client render),
     null = never synced from this device. */
  const [at, setAt] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    const read = () => setAt(readSynced(localStore()));
    read();
    // A minute is enough: the line is coarse ("an hour ago"), and the counter in
    // another tab may sync while this page is open.
    const timer = window.setInterval(read, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (at === undefined) return null;

  return (
    <div data-testid="account-synced">
      <dt>Last synced</dt>
      <dd title={at === null ? undefined : new Date(at).toLocaleString()}>
        {at === null
          ? premium
            ? "Not yet from this device — open the counter and it syncs on its own."
            : "Sync is part of Premium."
          : agoLabel(at)}
      </dd>
    </div>
  );
}
