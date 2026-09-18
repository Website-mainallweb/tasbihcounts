import { hasSessionCookie } from "@/lib/session-cookie";

import type { Entry } from "./outbox";

export { hasSessionCookie };

/**
 * When and how the counter talks to /api/sync (docs/ARCHITECTURE.md §4).
 *
 * Triggers: 10 s after the last change, at most 60 s after the first unsent one,
 * immediately when a mala completes, and on `visibilitychange → hidden` — the
 * primary chance before a phone puts the page away (pagehide is unreliable on
 * mobile). The hidden flush uses `keepalive`, so it survives the page closing.
 *
 * Only a signed-in browser syncs, and it finds out without loading anything:
 * Supabase keeps the session in a cookie, and the client library is imported only
 * once that cookie exists — a free user's counter downloads none of it.
 *
 * Pure of the engine: it asks the engine for pending entries and hands back
 * acknowledgements and other devices' totals through hooks.
 */

export type Totals = { c: number; r: number; s: number };
export type Ack = { key: string; version: number; confirmed: Totals };
export type Rejected = { key: string; reason: string };
/** Kept in step with OtherRow in lib/sync/schema.ts, without importing zod into the counter bundle. */
export type OtherRow = { day: string; naamId: string; kind: "devices" | "history" } & Totals;

export type SyncHooks = {
  pending(): Entry[];
  sourceId(): string;
  /**
   * Whether this tab may contact the server now. Every tab counts and every tab
   * may sync — the values sent are absolute and merged with GREATEST — so the
   * engine answers true; the hook stays so tests can switch sending off.
   */
  canSync(): boolean;
  onResult(acks: Ack[], rejected: Rejected[], others: OtherRow[], days: string[]): void;
  onPull(others: OtherRow[]): void;
  /** The server says this account has no Premium. */
  onNotPremium(): void;
};

export type SyncDeps = {
  getToken(): Promise<string | null>;
  fetch: typeof fetch;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const IDLE_MS = 10_000;
export const STALE_MS = 60_000;
export const PULL_EVERY_MS = 5 * 60_000;
const BACKOFF_MS = [5_000, 15_000, 60_000, 5 * 60_000];
const BATCH = 200;

export function createSyncClient(hooks: SyncHooks, deps: SyncDeps) {
  let idleTimer: unknown = null;
  let firstPendingAt: number | null = null;
  let inFlight = false;
  let failures = 0;
  let stopped = false;
  let lastPullAt = 0;

  const zone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  })();

  function schedule(ms: number) {
    if (idleTimer) deps.clearTimeout(idleTimer);
    idleTimer = deps.setTimeout(() => {
      idleTimer = null;
      void flush();
    }, ms);
  }

  async function send(path: string, body: unknown, keepalive: boolean) {
    const token = await deps.getToken();
    if (!token) return null;
    return deps.fetch(path, {
      method: "POST",
      keepalive,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  function handleRefusal(status: number): boolean {
    if (status === 401) {
      stopped = true; // signed out; the next page load starts again
      return true;
    }
    if (status === 403) {
      stopped = true;
      hooks.onNotPremium();
      return true;
    }
    return false;
  }

  async function flush(opts: { keepalive?: boolean } = {}): Promise<void> {
    if (stopped || inFlight || !hooks.canSync()) return;
    const entries = hooks.pending().slice(0, BATCH);
    if (!entries.length) {
      firstPendingAt = null;
      return;
    }

    inFlight = true;
    try {
      const res = await send(
        "/api/sync/",
        {
          sourceId: hooks.sourceId(),
          zone,
          offset: -new Date(deps.now()).getTimezoneOffset(),
          entries: entries.map((e) => ({ day: e.day, naamId: e.naamId, c: e.c, r: e.r, s: e.s, version: e.version })),
        },
        opts.keepalive === true,
      );
      if (!res) return; // not signed in
      if (handleRefusal(res.status)) return;
      if (!res.ok) throw new Error(`sync ${res.status}`);

      const data = (await res.json()) as { acks?: Ack[]; rejected?: Rejected[]; others?: OtherRow[] };
      failures = 0;
      hooks.onResult(data.acks ?? [], data.rejected ?? [], data.others ?? [], [...new Set(entries.map((e) => e.day))]);

      // More than one batch waiting, or taps that landed mid-flight: go again soon.
      firstPendingAt = hooks.pending().length ? deps.now() : null;
      if (firstPendingAt !== null) schedule(IDLE_MS);
    } catch {
      failures += 1;
      schedule(BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]);
    } finally {
      inFlight = false;
    }
  }

  async function pull(): Promise<void> {
    if (stopped || !hooks.canSync()) return;
    lastPullAt = deps.now();
    try {
      const res = await send("/api/sync/pull/", { sourceId: hooks.sourceId() }, false);
      if (!res || handleRefusal(res.status) || !res.ok) return;
      const data = (await res.json()) as { others?: OtherRow[] };
      hooks.onPull(data.others ?? []);
    } catch {
      // A missed pull is caught by the next one.
    }
  }

  return {
    /** The engine recorded a change: a tap, an undo, time on the mala. */
    changed() {
      if (stopped) return;
      const now = deps.now();
      firstPendingAt ??= now;
      const staleIn = STALE_MS - (now - firstPendingAt);
      schedule(Math.max(0, Math.min(IDLE_MS, staleIn)));
    },
    /** A mala completed, or the page is being hidden. */
    flushNow(opts?: { keepalive?: boolean }) {
      return flush(opts);
    },
    pull,
    /**
     * The one-time upload of this installation's records from before it first
     * synced, under the shared history source (SPEC §6, revised). Batches of 200.
     * Never touches the outbox or the watermark: history does not decide undo.
     * Resolves true once every batch was answered, rejected days included.
     */
    async sendHistory(entries: Entry[]): Promise<boolean> {
      if (stopped || !hooks.canSync()) return false;
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        try {
          const res = await send(
            "/api/sync/",
            {
              sourceId: hooks.sourceId(),
              kind: "history",
              zone,
              entries: batch.map((e) => ({ day: e.day, naamId: e.naamId, c: e.c, r: e.r, s: e.s, version: e.version })),
            },
            false,
          );
          if (!res || handleRefusal(res.status) || !res.ok) return false;
        } catch {
          return false;
        }
      }
      return true;
    },
    /** Coming back to the page after a while. */
    maybePull() {
      if (deps.now() - lastPullAt >= PULL_EVERY_MS) return pull();
      return Promise.resolve();
    },
    stop() {
      stopped = true;
      if (idleTimer) deps.clearTimeout(idleTimer);
    },
    get stopped() {
      return stopped;
    },
  };
}


/** The access token for the signed-in browser, loading Supabase only if there is one. */
export async function browserAccessToken(): Promise<string | null> {
  return (await browserSession())?.token ?? null;
}

/**
 * The signed-in browser's token and user id, loading Supabase only if there is a
 * session cookie. The id is read from the local session and is NOT trusted for
 * anything the server decides — the server takes the user from the token. The
 * counter uses it only to tell whose practice this device is holding
 * (lib/counter/account-link.ts).
 */
export async function browserSession(): Promise<{ token: string; userId: string } | null> {
  if (typeof document === "undefined") return null;
  if (!hasSessionCookie(document.cookie, process.env.NEXT_PUBLIC_SUPABASE_URL)) return null;
  const { browserSupabase } = await import("@/lib/supabase/browser");
  const { data } = await browserSupabase().auth.getSession();
  const s = data.session;
  return s?.access_token && s.user?.id ? { token: s.access_token, userId: s.user.id } : null;
}
