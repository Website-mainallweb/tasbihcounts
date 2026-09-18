import { authErrorResponse, requireBearerUser, requirePremium } from "@/lib/dal";
import { flagOn } from "@/lib/flags";
import { allow } from "@/lib/rate-limit";
import { PullRequest, toOtherRow, type OtherRow } from "@/lib/sync/schema";

/**
 * Everyone else's totals, for a device catching up — on sign-in, on coming back
 * to the page. Read only: nothing is written, and row-level security limits the
 * sums to the caller's own rows. Other devices and shared history come back as
 * separate kinds, because the client adds one and compares with the other.
 */

const PER_MINUTE = 30;

export async function POST(request: Request) {
  /* The cloud sync kill switch (docs/ADMIN.md §3.8). 503 rather than 403: the
     client retries a 503 later and treats a 403 as "you are not allowed", which
     would have it stop trying for good. Every device keeps counting locally and
     uploads what it held once this comes back on. */
  if (!(await flagOn("cloud_sync"))) {
    return Response.json({ error: "sync_off" }, { status: 503 });
  }

  let authed;
  try {
    authed = await requirePremium(await requireBearerUser(request));
  } catch (err) {
    return authErrorResponse(err);
  }
  const { user, supabase } = authed;

  if (!allow(`pull:${user.id}`, PER_MINUTE, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = PullRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const { data, error } = await supabase.rpc("sync_others", {
    p_source: parsed.data.sourceId,
    p_since: parsed.data.since ?? null,
  });
  if (error) return Response.json({ error: "unavailable" }, { status: 503 });

  const others: OtherRow[] = ((data ?? []) as Parameters<typeof toOtherRow>[0][]).map(toOtherRow);
  return Response.json({ others });
}
