"use client";

/**
 * Cross-tab coordination.
 * Specification sections 10, 90, 133.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * Open the counter in two tabs. Both hydrate from IndexedDB, both hold their own
 * copy of the counter in memory, and both write back on a throttle. Tab A counts
 * to 40 and writes; tab B — which loaded at 12 and has been idle — writes 12 on
 * its next flush, and twenty-eight counts are gone. Settings fight the same way:
 * change the theme in one tab and the other overwrites it on its next save.
 *
 * Nothing in the product noticed, because each tab was individually correct.
 *
 * TWO MECHANISMS, FOR TWO DIFFERENT PROBLEMS
 *
 *   BroadcastChannel  tells the other tabs what just changed, so they can
 *                     re-read rather than overwrite. This is the one that
 *                     matters, and it is well supported everywhere the rest of
 *                     this product works.
 *
 *   Web Locks         serialises the one operation where two tabs writing at
 *                     the same instant would corrupt rather than merely lose:
 *                     sealing a session and rolling up the totals.
 *
 * Both degrade to no-ops. A browser without either behaves exactly as the
 * product did before this file existed, which is to say: correct in one tab.
 */

const CHANNEL = "tasbihcounts";

export type TabMessage =
  /** A session was sealed or deleted; totals must be recomputed. */
  | { type: "sessions-changed"; from: string }
  /** The counter state for one dhikr moved. */
  | { type: "counter-changed"; from: string; dhikrId: string }
  /** Settings were saved. */
  | { type: "settings-changed"; from: string }
  /** Custom dhikr or sequences were added, edited or removed. */
  | { type: "library-changed"; from: string }
  /** This tab is counting right now, so others should not seal its session. */
  | { type: "active"; from: string };

/** This tab's own id, so a tab never reacts to its own message. */
export const TAB_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;

let channel: BroadcastChannel | null = null;

function get(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (typeof BroadcastChannel === "undefined") return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL);
  } catch {
    channel = null;
  }
  return channel;
}

export function broadcast(message: Omit<TabMessage, "from">): void {
  const c = get();
  if (!c) return;
  try {
    c.postMessage({ ...message, from: TAB_ID } as TabMessage);
  } catch {
    /* a closed channel must never break counting */
  }
}

/**
 * Subscribe to messages from OTHER tabs. Messages this tab sent are filtered
 * out, so a handler can react without checking.
 */
export function subscribe(handler: (message: TabMessage) => void): () => void {
  const c = get();
  if (!c) return () => {};

  const listener = (event: MessageEvent) => {
    const message = event.data as TabMessage | undefined;
    if (!message || typeof message !== "object") return;
    if (message.from === TAB_ID) return;
    handler(message);
  };

  c.addEventListener("message", listener);
  return () => c.removeEventListener("message", listener);
}

/**
 * Run `fn` while holding a named lock, so two tabs cannot interleave inside it.
 *
 * Used only where interleaving would CORRUPT rather than merely lose: sealing a
 * session and rebuilding the roll-ups. Wrapping every write would serialise the
 * counter across tabs and make tapping feel slow, which is a worse outcome than
 * the problem.
 *
 * Without the Web Locks API the function simply runs, which is what happened
 * before this existed.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  // The guard has to come BEFORE the property read, not after it. As first
  // written this dereferenced `navigator` and only then asked whether
  // `navigator` existed, so on the server it threw a ReferenceError and the
  // check below was unreachable.
  if (typeof navigator === "undefined") return fn();

  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return fn();

  try {
    return await locks.request(`tasbihcounts:${name}`, fn);
  } catch {
    // A lock that cannot be taken must not stop the work.
    return fn();
  }
}
