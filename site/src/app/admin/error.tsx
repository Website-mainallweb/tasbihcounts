"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * What the panel shows when a screen fails to load.
 *
 * Without this, Next renders its own bare error page: no navigation, no
 * explanation, and nothing that says which of the panel's several databases and
 * services just refused. The panel is the thing you open *during* an incident,
 * so failing into a dead end is the worst moment to do it.
 *
 * It does not print the error's message. In production Next replaces a server
 * error's message with a digest before it ever reaches the browser — the real
 * text is in the server log — so the digest is what actually identifies this
 * failure, and inventing a friendlier message would only obscure it.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server log has the real error; this makes the same failure findable
    // from the browser console while looking at it.
    console.error("admin screen failed", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="wrap">
      <p className="eyebrow">Something went wrong</p>
      <h1>This screen could not load</h1>

      <p className="lede">
        The panel reached the database and did not get an answer it could use. The rest of the panel
        is probably fine — try again, and if it keeps failing, the two things worth checking are
        whether Supabase is up and whether the migrations in <code>supabase/migrations</code> have
        all been applied.
      </p>

      <p className="error">
        {error.digest ? (
          <>
            Reference <code>{error.digest}</code> — the full error is in the server log under this
            id.
          </>
        ) : (
          "No reference was attached to this error; the server log has the detail."
        )}
      </p>

      <div className="row-actions">
        <button type="button" onClick={reset}>
          Try again
        </button>
        <Link className="pill" href="/admin/">
          Back to the overview
        </Link>
      </div>

      <p className="protected">
        Nothing was changed by this. Every action in the panel writes its audit row before it reports
        success, so a screen that failed to load has not half-done anything.
      </p>
    </div>
  );
}
