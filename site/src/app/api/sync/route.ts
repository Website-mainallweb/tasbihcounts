import { authErrorResponse, requireBearerUser, requirePremium } from "@/lib/dal";
import { flagOn } from "@/lib/flags";
import { allow } from "@/lib/rate-limit";
import {
  HISTORY_SOURCE,
  keyOf,
  planSync,
  SyncRequest,
  toOtherRow,
  type Ack,
  type OtherRow,
  type Rejected,
  type SyncResponse,
} from "@/lib/sync/schema";

/**
 * Sync: this device's components up, everyone else's totals down
 * (docs/ARCHITECTURE.md §1, §4).
 *
 * Bearer token, not cookies (ARCHITECTURE M2): the client sends with
 * `fetch(..., { keepalive: true })`, which survives the page closing and can
 * carry a header a cross-site page cannot forge.
 *
 * The user comes from the token, never the body. Every write goes through a
 * client acting as that user, so row-level security decides what it may touch,
 * the premium policy decides whether it may write at all, and the database
 * trigger keeps every component from going down. Nothing here uses the service
 * role.
 *
 * `kind: "history"` writes the same entries under the shared history source —
 * the one-time upload of a device's records from before it first synced
 * (SPEC §6, revised).
 */

const MAX_BODY = 256_000;
const PER_MINUTE = 60;

type Row = { day: string; naam_id: string; count: number; rounds: number; ms: number };

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

  if (!allow(`sync:${user.id}`, PER_MINUTE, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = SyncRequest.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const { sourceId, kind, zone, offset } = parsed.data;
  const writeAs = kind === "history" ? HISTORY_SOURCE : sourceId;
  const { valid, rejected } = planSync(parsed.data.entries);
  const versions = new Map(valid.map((e) => [keyOf(e.day, e.naamId), e.version]));

  const toRow = (e: (typeof valid)[number]) => ({
    user_id: user.id, // from the verified token, never the body
    day: e.day,
    naam_id: e.naamId,
    source_id: writeAs,
    count: e.c,
    rounds: e.r,
    ms: e.s,
    zone: zone ?? null,
    offset_minutes: offset ?? null,
  });

  const written: Row[] = [];
  const refused: Rejected[] = [...rejected];
  const columns = "day, naam_id, count, rounds, ms";

  if (valid.length) {
    const { data, error } = await supabase
      .from("counter_components")
      .upsert(valid.map(toRow), { onConflict: "user_id,day,naam_id,source_id" })
      .select(columns);

    if (!error) {
      written.push(...((data ?? []) as Row[]));
    } else if (error.code === "54000" || error.code === "22008") {
      // One row broke a database rule the plan could not see (the source cap).
      // Write row by row so the rest still land, and refuse only the offenders.
      for (const e of valid) {
        const one = await supabase
          .from("counter_components")
          .upsert(toRow(e), { onConflict: "user_id,day,naam_id,source_id" })
          .select(columns);
        if (one.error) {
          refused.push({ key: keyOf(e.day, e.naamId), reason: one.error.code === "54000" ? "sources" : "clock" });
        } else {
          written.push(...((one.data ?? []) as Row[]));
        }
      }
    } else {
      return Response.json({ error: "unavailable" }, { status: 503 });
    }
  }

  const acks: Ack[] = written.map((row) => {
    const key = keyOf(row.day, row.naam_id);
    return { key, version: versions.get(key) ?? 0, confirmed: { c: row.count, r: row.rounds, s: row.ms } };
  });

  let others: OtherRow[] = [];
  const days = [...new Set(valid.map((e) => e.day))];
  if (kind === "device" && days.length) {
    const { data, error } = await supabase.rpc("sync_others", { p_source: sourceId, p_days: days });
    if (!error) others = ((data ?? []) as Parameters<typeof toOtherRow>[0][]).map(toOtherRow);
  }

  const response: SyncResponse = { acks, rejected: refused, others };
  return Response.json(response);
}
