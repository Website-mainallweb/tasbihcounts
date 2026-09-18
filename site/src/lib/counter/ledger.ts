"use client";

/**
 * The practice ledger: what the counter has recorded, where it is stored, and how
 * it reaches the account.
 *
 * The Tasbih counter (components/counter, stores/counter-store.ts) owns what is on
 * screen — the ring, targets, routines, rites. This module owns the record. Every
 * tap the counter makes is reported here as "n counts, r rounds, for this dhikr",
 * and from there it follows exactly the path the old Nam Jap engine used:
 *
 *   localStorage (njc.hot / njc.cold, lib/counter/storage.ts)
 *     → outbox (lib/counter/outbox.ts)
 *     → /api/sync (lib/counter/sync-client.ts)
 *     → public.counter_components
 *
 * so Stats, Streak, the account page, backups, the admin panel and the database
 * read the same shape they always have. It is that engine's data half with the
 * DOM taken out; the comments on the rules it keeps are in
 * components/counter-engine.js history and in docs/ARCHITECTURE.md.
 *
 * One ledger per page, started by the counter and stopped when it unmounts.
 */

import * as AccountLink from "./account-link";
import * as Backup from "./backup";
import * as Combine from "./combine";
import { dayKey } from "./day";
import * as Outbox from "./outbox";
import * as Storage from "./storage";
import type { DayRec, NameRec, State } from "./storage";
import { summarise, type StreakSummary } from "./streak";
import { browserAccessToken, browserSession, createSyncClient, hasSessionCookie } from "./sync-client";
import { writePremiumFlag } from "@/lib/premium-flag";

/** What a round is when no target is set: one pass of a 33-bead tasbih. */
export const ROUND_FALLBACK = 33;
/** Three minutes with no count is not time spent counting. */
const IDLE_MS = 180_000;

export type Notice = {
  id: number;
  text: string;
  tone?: "good" | "bad";
  actionLabel?: string;
  onAction?: () => void;
};

export type LedgerView = {
  today: number;
  lifetime: number;
  streak: StreakSummary;
  hist: Record<string, DayRec>;
  signedIn: boolean;
  linked: boolean;
  notice: Notice | null;
};

const BLANK: Record<string, unknown> = {
  v: 1,
  nameId: null,
  custom: [],
  favs: [],
  lastBackup: null,
  importedBackups: [],
  nudgedOn: null,
  count: 0,
  target: 33,
  rounds: null,
  malaDone: 0,
  lifetime: 0,
  hist: {},
  lastDay: dayKey(),
};

type S_ = State & {
  hist: Record<string, DayRec>;
  lifetime: number;
  nameId?: string | null;
  syncFrom?: string;
  historyUploaded?: boolean;
  owner?: string;
  lastBackup?: string | null;
  nudgedOn?: string | null;
};

const todayKey = () => dayKey();
const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("en");

/* ---------- state ---------- */

let S: S_ = fresh();
const store = Storage.localStore();
let sourceId = "";
let outbox: Outbox.Outbox = {};
let watermark: Outbox.Watermark = {};
let coldDirty = false;
let others = Combine.emptyOthers();
let hasOthers = false;
let lastRev: string | null = null;
let hotSaved: string | null = null;

let sync: ReturnType<typeof createSyncClient> | null = null;
let linkedTo: string | null = null;
let linking = false;
let linkTries = 0;
const LINK_RETRY_MS = [3000, 10000, 30000];

let lastCountAt = 0;
let sessionMark = Date.now();
/** The dhikr time is credited to: the one counted last. */
let timeName: string | null = null;

let notice: Notice | null = null;
let noticeSeq = 0;
let notSavingWarned = false;

let starts = 0;
let teardowns: (() => void)[] = [];
const listeners = new Set<() => void>();
let snapshot: LedgerView | null = null;

function fresh(): S_ {
  return { ...(JSON.parse(JSON.stringify(BLANK)) as S_), lastDay: todayKey() };
}

/* ---------- persistence ---------- */

function load(): void {
  const r = Storage.load(store);
  sourceId = r.sourceId;
  outbox = Outbox.readOutbox(r.outbox);
  watermark = Outbox.readWatermark(r.watermark);
  const st = r.fresh ? {} : r.state;
  S = { ...fresh(), ...st } as S_;
  S.syncFrom = typeof st.syncFrom === "string" ? st.syncFrom : undefined;
  S.historyUploaded = st.historyUploaded === true;
  S.owner = typeof st.owner === "string" ? st.owner : undefined;
  setOthers(Combine.readOthers(st.others));
  if (!S.hist || typeof S.hist !== "object") S.hist = {};
  if (!Array.isArray(S.custom)) S.custom = [];
  if (!Array.isArray(S.favs)) S.favs = [];
  if (typeof S.lifetime !== "number") S.lifetime = 0;
  S.lastDay = todayKey();
  if (r.migrated) saveCold();
  // Anything read before this load (a view taken before the ledger started) is stale.
  snapshot = null;
}

function setOthers(o: Combine.Others): void {
  others = o;
  S.others = o;
  hasOthers = Object.keys(o.devices).length > 0 || Object.keys(o.history).length > 0;
}

function viewHist(): Record<string, DayRec> {
  return hasOthers ? Combine.combinedHistory(S.hist, others) : S.hist;
}

function stamp(): void {
  lastRev = Storage.touchRev(store);
}

function saveCold(): void {
  Storage.saveCold(store, S, { sourceId });
  coldDirty = false;
  stamp();
}

function hotSignature(): string {
  return [
    S.lifetime,
    S.lastDay,
    S.nameId,
    JSON.stringify(S.hist[todayKey()] ?? null),
    JSON.stringify(outbox),
  ].join("|");
}

function saveTap(): void {
  Storage.saveHot(store, S, { sourceId, outbox, watermark });
  hotSaved = hotSignature();
  stamp();
}

function saveTapIfUnsaved(): void {
  if (hotSignature() !== hotSaved) saveTap();
}

function flushCold(): void {
  if (coldDirty) saveCold();
}

function save(): void {
  coldDirty = true;
  saveTap();
  flushCold();
}

/** Take in what another tab saved since this one last looked. */
function adoptIfChanged(): boolean {
  const rev = Storage.readRev(store);
  if (rev === lastRev) return false;
  lastRev = rev;
  load();
  emit();
  return true;
}

/* ---------- records ---------- */

function dayRec(k = todayKey()): DayRec {
  if (!S.hist[k]) S.hist[k] = { c: 0, r: 0, s: 0 };
  return S.hist[k];
}

/**
 * The day's numbers split by dhikr. A day that has a total but no breakdown yet
 * seeds it onto the dhikr being counted, so the parts keep adding up to the whole.
 */
function nameRec(id: string, k = todayKey()): NameRec {
  const day = dayRec(k);
  if (!day.n) {
    day.n = {};
    if (day.c || day.r || day.s) day.n[id] = { c: day.c, r: day.r || 0, s: day.s || 0 };
  }
  if (!day.n[id]) day.n[id] = { c: 0, r: 0, s: 0 };
  return day.n[id];
}

function markOutbox(id: string | null): void {
  if (!id) return;
  const rec = nameRec(id);
  if (!rec.c && !rec.r && !rec.s && !outbox[Outbox.keyOf(todayKey(), id)]) return;
  outbox = Outbox.mark(outbox, todayKey(), id, { c: rec.c, r: rec.r, s: rec.s });
}

function rollover(): void {
  if (S.lastDay !== todayKey()) {
    S.lastDay = todayKey();
    coldDirty = true;
    flushCold();
  }
}

/** Time spent counting, from the first count until three minutes after the last. */
function tickTime(): void {
  const n = Date.now();
  const delta = n - sessionMark;
  sessionMark = n;
  if (!lastCountAt || n - lastCountAt > IDLE_MS || !timeName) return;
  if (delta > 0 && delta < 120_000) {
    const mine = nameRec(timeName);
    dayRec().s = (dayRec().s || 0) + delta;
    mine.s += delta;
  }
}

function warnIfNotSaving(): void {
  if (notSavingWarned || !store.writeFailed?.()) return;
  notSavingWarned = true;
  show({
    text: "This browser is not saving your dhikr — a reload would lose it. Use a normal (not private) window, or download a backup now.",
    tone: "bad",
    actionLabel: "Back up",
    onAction: exportBackup,
  });
}

/**
 * Record `c` counts and `r` completed rounds for one dhikr.
 * Called by the counter on every tap, after its own state has moved.
 */
export function record(id: string, c: number, r = 0): void {
  if (!id || c <= 0) return;
  adoptIfChanged();
  rollover();
  tickTime();
  lastCountAt = Date.now();
  timeName = id;

  const mine = nameRec(id);
  S.lifetime = (S.lifetime || 0) + c;
  dayRec().c += c;
  mine.c += c;
  if (r > 0) {
    dayRec().r = (dayRec().r || 0) + r;
    mine.r += r;
  }
  S.nameId = id;
  markOutbox(id);
  if (sync) {
    if (r > 0) sync.flushNow();
    else sync.changed();
  }
  saveTap();
  warnIfNotSaving();
  emit();
}

/** How many of today's counts for this dhikr can still be taken back. */
export function undoable(id: string): number {
  const rec = S.hist[todayKey()]?.n?.[id];
  return Outbox.undoableCount(watermark, todayKey(), id, rec?.c ?? 0);
}

/**
 * Take back what `record` added. Refused — returns false — when the server has
 * already confirmed those counts: lowering them here would be undone by the next
 * sync, and the tap would come back.
 */
export function unrecord(id: string, c: number, r = 0): boolean {
  if (!id || c <= 0) return true;
  adoptIfChanged();
  if (undoable(id) < c) return false;
  const rec = dayRec();
  const mine = nameRec(id);
  S.lifetime = Math.max(0, (S.lifetime || 0) - c);
  rec.c = Math.max(0, rec.c - c);
  mine.c = Math.max(0, mine.c - c);
  if (r > 0) {
    rec.r = Math.max(0, (rec.r || 0) - r);
    mine.r = Math.max(0, mine.r - r);
  }
  markOutbox(id);
  sync?.changed();
  saveTap();
  emit();
  return true;
}

/** True once today's counts have reached the account and can no longer be erased here. */
function syncedToday(): boolean {
  const p = todayKey() + "|";
  return Object.keys(watermark).some((k) => k.startsWith(p));
}

/** Remove today's record from this device. Refused once it has been synced. */
export function clearToday(): { ok: boolean; reason?: string } {
  adoptIfChanged();
  if (syncedToday()) {
    return { ok: false, reason: "Today's counts are already saved to your account and cannot be erased here." };
  }
  const gone = S.hist[todayKey()]?.c ?? 0;
  S.lifetime = Math.max(0, (S.lifetime || 0) - gone);
  delete S.hist[todayKey()];
  for (const k of Object.keys(outbox)) if (k.startsWith(todayKey() + "|")) delete outbox[k];
  save();
  emit();
  return { ok: true };
}

/** Erase this device's whole record. Refused once anything has been synced. */
export function eraseAll(): { ok: boolean; reason?: string } {
  adoptIfChanged();
  if (Object.keys(watermark).length) {
    return {
      ok: false,
      reason: "Your history is saved to your account. To erase it, write to us to delete the account.",
    };
  }
  outbox = {};
  const keep = { owner: S.owner };
  S = { ...fresh(), ...keep } as S_;
  setOthers(Combine.emptyOthers());
  save();
  emit();
  return { ok: true };
}

/**
 * Keep the words of a dhikr the person wrote themselves, so Stats, Streak and a
 * backup file can name it. Never removed when the dhikr is: its history stays,
 * and it should keep reading as the words that were counted.
 */
export function rememberCustom(e: { id: string; n: string; t: string; m: string }): void {
  if (!/^c[A-Za-z0-9_-]{1,60}$/.test(e.id)) return;
  adoptIfChanged();
  const clip = (v: string) => String(v || "").slice(0, 120);
  const list = (Array.isArray(S.custom) ? S.custom : []).filter(
    (x) => !(x && typeof x === "object" && (x as { id?: unknown }).id === e.id),
  );
  list.push({ id: e.id, n: clip(e.n), t: clip(e.t), m: clip(e.m) });
  S.custom = list;
  save();
  emit();
}

/* ---------- backup ---------- */

export function exportBackup(): void {
  adoptIfChanged();
  const blob = Backup.makeBackup(Backup.localOnly(S), { sourceId, backupId: Storage.newSourceId() });
  const b = new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = `tasbih-counts-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  S.lastBackup = todayKey();
  save();
}

/**
 * Read a backup file and offer to merge it. A backup is untrusted input: it is
 * parsed as data and every field is checked in lib/counter/backup.ts. Merging
 * only ever raises counts, so restoring an old file cannot delete anything.
 */
export function importBackup(file: File): void {
  if (file.size > Backup.MAX_FILE_BYTES) {
    show({ text: "That file is too large to be a Tasbih Counts backup", tone: "bad" });
    return;
  }
  const rd = new FileReader();
  rd.onerror = () => show({ text: "That file could not be read", tone: "bad" });
  rd.onload = () => {
    let parsed: Backup.ParsedBackup;
    try {
      parsed = Backup.parseBackup(String(rd.result), BLANK, todayKey());
    } catch (e) {
      show({
        text:
          e instanceof Error && e.message === "too-large"
            ? "That file is too large to be a Tasbih Counts backup"
            : "That file could not be read",
        tone: "bad",
      });
      return;
    }
    adoptIfChanged();
    const preview = Backup.mergeBackup(S, parsed.state);
    if (!preview.chantsAdded && !preview.daysAdded && !preview.daysRaised && !preview.namesAdded) {
      show({ text: "This file has nothing new to add.", tone: "good" });
      return;
    }
    show({
      text: `This file adds ${fmt(preview.chantsAdded)} counts to your practice (days changed: ${fmt(
        preview.daysAdded + preview.daysRaised,
      )}). Counts only go up, so this cannot be undone.`,
      actionLabel: "Add them",
      onAction: () => {
        adoptIfChanged();
        const r = Backup.mergeBackup(S, parsed.state);
        if (Storage.tooLarge(r.state)) {
          show({ text: "That file is too large to be a Tasbih Counts backup", tone: "bad" });
          return;
        }
        S = { ...S, ...r.state } as S_;
        if (parsed.meta.backupId) {
          S.importedBackups = Backup.rememberImport(S, parsed.meta.backupId).importedBackups;
        }
        save();
        emit();
        show({
          text: `Restored. ${fmt(r.daysAdded)} new days added, ${fmt(r.daysRaised)} updated. Nothing was removed.`,
          tone: "good",
        });
      },
    });
  };
  rd.readAsText(file);
}

/* ---------- notices ---------- */

function show(n: Omit<Notice, "id">): void {
  notice = { ...n, id: ++noticeSeq };
  emit();
}

export function dismissNotice(): void {
  notice = null;
  emit();
}

/* ---------- sync (Premium) ---------- */

function syncFloor(): string {
  return S.syncFrom || todayKey();
}

let historyInFlight = false;
function uploadHistory(): void {
  if (!sync || historyInFlight || S.historyUploaded || !S.syncFrom) return;
  historyInFlight = true;
  const entries = AccountLink.historyEntries(S.hist, S.syncFrom);
  void sync.sendHistory(entries).then((done: boolean) => {
    historyInFlight = false;
    if (done && sync) {
      adoptIfChanged();
      S.historyUploaded = true;
      coldDirty = true;
      flushCold();
      sync.pull();
    }
  });
}

function signedInHere(): boolean {
  try {
    return hasSessionCookie(document.cookie, process.env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    return false;
  }
}

function pullRows(token: string): Promise<unknown[] | null> {
  return window
    .fetch("/api/sync/pull/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ sourceId }),
    })
    .then(
      (res) =>
        res.ok
          ? res.json().then((d: { others?: unknown }) => (Array.isArray(d.others) ? d.others : []))
          : null,
      () => null,
    );
}

function claimFor(userId: string): boolean {
  S.owner = userId;
  save();
  return true;
}

function linkAccount(): Promise<void> {
  if (linking || linkedTo !== null) return Promise.resolve();
  linking = true;
  return browserSession()
    .then((sess): boolean | Promise<boolean> => {
      if (!sess || !sync) return false;
      adoptIfChanged();
      const decision = AccountLink.decide(S, sess.userId);
      if (decision === "linked") return true;
      if (decision === "adopt" || decision === "claim") return claimFor(sess.userId);
      if (decision === "switch") {
        AccountLink.startEmptyFor(store, sess.userId, todayKey());
        load();
        emit();
        return true;
      }
      return pullRows(sess.token).then((rows) => {
        if (rows === null || !sync) return false;
        adoptIfChanged();
        if (!rows.length) return claimFor(sess.userId);
        if (!AccountLink.setAside(store, sess.userId, todayKey())) return false;
        load();
        emit();
        return true;
      });
    })
    .then(
      (ok) => {
        linking = false;
        if (!ok) {
          if (sync && signedInHere() && linkTries < LINK_RETRY_MS.length) {
            const again = setTimeout(linkAccount, LINK_RETRY_MS[linkTries++]);
            teardowns.push(() => clearTimeout(again));
          }
          return;
        }
        if (!sync) return;
        linkedTo = S.owner ?? null;
        sync.pull();
        uploadHistory();
        if (Outbox.pending(outbox).length) sync.changed();
        offerStash();
        emit();
      },
      () => {
        linking = false;
      },
    );
}

function offerStash(): void {
  const stash = AccountLink.readStash(store);
  if (!stash || stash.askedOn) return;
  const st = AccountLink.stashedState(store);
  const n = st ? AccountLink.chantsIn(st) : 0;
  if (!n) {
    AccountLink.dropStash(store);
    return;
  }
  AccountLink.markStashAsked(store, todayKey());
  show({
    text: `This device has ${fmt(n)} counts from before you signed in. They are kept on this device, not in your account.`,
    actionLabel: "Add to my account",
    onAction: addStash,
  });
}

function addStash(): void {
  const fail = () =>
    show({
      text: "Could not add them just now. Check your internet connection and try again.",
      tone: "bad",
      actionLabel: "Add to my account",
      onAction: addStash,
    });
  browserAccessToken()
    .then((token) => AccountLink.uploadStash(store, token, (u, i) => window.fetch(u, i)))
    .then((done) => {
      if (!done) return fail();
      adoptIfChanged();
      const st = AccountLink.stashedState(store);
      if (st) {
        const names = AccountLink.namesFromStash(S, st);
        S.custom = names.custom;
        S.favs = names.favs;
      }
      AccountLink.dropStash(store);
      save();
      sync?.pull();
      show({ text: "Added to your account.", tone: "good" });
    }, fail);
}

/* ---------- backup nudge ---------- */

function daysSince(key: unknown): number {
  if (typeof key !== "string") return Infinity;
  const then = new Date(key + "T00:00:00");
  if (isNaN(then.getTime())) return Infinity;
  return Math.floor((Date.now() - then.getTime()) / 86_400_000);
}

function safariMayEvict(): boolean {
  try {
    const ua = navigator.userAgent || "";
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const macSafari = /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia?.("(display-mode: standalone)").matches;
    return (ios || macSafari) && !standalone;
  } catch {
    return false;
  }
}

function maybeNudgeBackup(): void {
  adoptIfChanged();
  if (S.owner || notice) return;
  const evictable = safariMayEvict();
  if ((S.lifetime || 0) < (evictable ? 100 : 1000)) return;
  const every = evictable ? 7 : 30;
  if (daysSince(S.lastBackup) < every || daysSince(S.nudgedOn) < every) return;
  S.nudgedOn = todayKey();
  save();
  show({
    text: evictable
      ? "Safari can delete this site's saved counts if you do not visit for a week. Save a backup file, or add this page to your Home Screen to keep it."
      : "Your counts live only in this browser. Keep a backup file somewhere safe.",
    actionLabel: "Back up",
    onAction: exportBackup,
  });
}

/* ---------- lifecycle ---------- */

function on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions | boolean): void {
  target.addEventListener(type, fn, opts);
  teardowns.push(() => target.removeEventListener(type, fn, opts));
}

function every(fn: () => void, ms: number): void {
  const id = setInterval(fn, ms);
  teardowns.push(() => clearInterval(id));
}

function boot(): void {
  load();
  lastRev = Storage.readRev(store);
  // Written once at start, so this installation keeps its source id from the
  // first visit rather than from the first tap.
  saveTapIfUnsaved();
  // And the cold half, so the history always has a home on disk, not only
  // after the first setting or day changes.
  if (store.getItem(Storage.COLD_KEY) === null) saveCold();
  emit();
  void Storage.requestPersistence();

  sync = createSyncClient(
    {
      pending: () => Outbox.pending(outbox).filter((e) => e.day >= syncFloor()),
      sourceId: () => sourceId,
      canSync: () => linkedTo !== null && S.owner === linkedTo,
      onResult(acks, rejected, rows, days) {
        adoptIfChanged();
        const r = Outbox.acknowledge(outbox, watermark, acks);
        outbox = r.outbox;
        watermark = r.watermark;
        for (const x of rejected) delete outbox[x.key];
        if (acks.length && !S.syncFrom) {
          S.syncFrom = todayKey();
          for (const k of Object.keys(outbox)) if (outbox[k].day < S.syncFrom) delete outbox[k];
        }
        setOthers(Combine.mergeOthers(others, rows, days));
        store.setItem(Storage.SYNCED_KEY, String(Date.now()));
        coldDirty = true;
        saveTap();
        flushCold();
        uploadHistory();
        emit();
      },
      onPull(rows) {
        adoptIfChanged();
        store.setItem(Storage.SYNCED_KEY, String(Date.now()));
        setOthers(Combine.mergeOthers(others, rows, "all"));
        coldDirty = true;
        flushCold();
        emit();
      },
      onNotPremium: () => writePremiumFlag(false),
    },
    {
      getToken: browserAccessToken,
      fetch: (u, i) => window.fetch(u, i),
      now: () => Date.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (h) => window.clearTimeout(h as number),
    },
  );
  void linkAccount();

  on(window, "storage", (e) => {
    const key = (e as StorageEvent).key;
    if (key !== null && key !== Storage.REV_KEY) return;
    adoptIfChanged();
  });

  on(document, "visibilitychange", () => {
    if (document.hidden) {
      adoptIfChanged();
      tickTime();
      markOutbox(timeName);
      saveTapIfUnsaved();
      flushCold();
      sync?.flushNow({ keepalive: true });
    } else {
      sessionMark = Date.now();
      if (linkedTo === null) void linkAccount();
      sync?.maybePull();
    }
  });

  on(window, "pagehide", () => {
    adoptIfChanged();
    tickTime();
    markOutbox(timeName);
    saveTapIfUnsaved();
    flushCold();
    sync?.flushNow({ keepalive: true });
  });

  every(() => {
    adoptIfChanged();
    tickTime();
    if (lastCountAt && timeName) {
      markOutbox(timeName);
      sync?.changed();
    }
    saveTap();
    flushCold();
  }, 20_000);

  every(() => {
    adoptIfChanged();
    if (S.lastDay !== todayKey()) {
      S.lastDay = todayKey();
      save();
      emit();
    }
    if (linkedTo === null) void linkAccount();
  }, 60_000);

  const nudge = setTimeout(maybeNudgeBackup, 1200);
  teardowns.push(() => clearTimeout(nudge));
}

/** Start the ledger for this page. Returns the matching stop. */
export function start(): () => void {
  if (typeof window === "undefined") return () => {};
  if (starts++ === 0) boot();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--starts > 0) return;
    tickTime();
    markOutbox(timeName);
    saveTapIfUnsaved();
    flushCold();
    sync?.flushNow({ keepalive: true });
    sync?.stop();
    sync = null;
    linkedTo = null;
    linking = false;
    linkTries = 0;
    for (let i = teardowns.length - 1; i >= 0; i--) {
      try {
        teardowns[i]();
      } catch {
        /* already gone */
      }
    }
    teardowns = [];
  };
}

/* ---------- reading ---------- */

function emit(): void {
  snapshot = null;
  for (const l of listeners) l();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: LedgerView = {
  today: 0,
  lifetime: 0,
  streak: { current: 0, best: 0, totalDays: 0, atRisk: false },
  hist: {},
  signedIn: false,
  linked: false,
  notice: null,
};

export function getView(): LedgerView {
  if (typeof window === "undefined") return EMPTY;
  if (snapshot) return snapshot;
  const hist = viewHist();
  snapshot = {
    today: hist[todayKey()]?.c ?? 0,
    lifetime: (S.lifetime || 0) + (hasOthers ? Combine.extraLifetime(S.hist, others) : 0),
    streak: summarise(hist, todayKey()),
    hist,
    signedIn: signedInHere(),
    linked: linkedTo !== null,
    notice,
  };
  return snapshot;
}

export function getServerView(): LedgerView {
  return EMPTY;
}
