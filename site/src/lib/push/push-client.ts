import { browserAccessToken } from "@/lib/counter/sync-client";

/**
 * Turning reminders on and off in this browser.
 *
 * Firebase's messaging library is loaded only here, only when someone switches
 * reminders on — the counter itself never downloads it.
 *
 * iOS delivers web push only to a site added to the Home Screen, and only from
 * iOS 16.4. isStandaloneIos() lets the UI say so instead of failing silently.
 */

export type EnableResult =
  | "enabled"
  | "unsupported"
  | "needs-home-screen"
  | "denied"
  | "dismissed"
  | "not-signed-in"
  | "failed";

const SW_URL = "/firebase-messaging-sw.js";
const SW_SCOPE = "/firebase-cloud-messaging-push-scope";

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function api(path: string, body: unknown): Promise<boolean> {
  const token = await browserAccessToken();
  if (!token) return false;
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.ok;
}

function zone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

export async function enableReminders(sourceId: string, remindAt: number): Promise<EnableResult> {
  if (isIos() && !isStandalone()) return "needs-home-screen";
  if (!supported()) return "unsupported";
  if (!(await browserAccessToken())) return "not-signed-in";

  const permission = await Notification.requestPermission();
  /* B44: closing the prompt is not blocking the site; it can simply be asked again. */
  if (permission === "default") return "dismissed";
  if (permission !== "granted") return "denied";

  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    const [{ initializeApp, getApps }, { getMessaging, getToken }] = await Promise.all([
      import("firebase/app"),
      import("firebase/messaging"),
    ]);
    const app =
      getApps()[0] ??
      initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      });
    const fcmToken = await getToken(getMessaging(app), {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!fcmToken) return "failed";

    const registered = await api("/api/push/register/", { sourceId, token: fcmToken });
    const saved = registered && (await api("/api/reminders/", { enabled: true, zone: zone(), remindAt }));
    return saved ? "enabled" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Saves the reminder time without changing whether reminders are on (B43): a
 * time picked while this device had them off used to be dropped. `enabled` is
 * the account's current value, passed back unchanged.
 */
export async function saveReminderTime(remindAt: number, enabled: boolean): Promise<boolean> {
  try {
    return await api("/api/reminders/", { enabled, zone: zone(), remindAt });
  } catch {
    return false;
  }
}

/**
 * Stops reminders on this device only. The time belongs to the account and other
 * devices keep theirs — switching the account off here used to silence every
 * device at once. The scheduler sends nothing to an account with no device left,
 * so nothing else needs switching off.
 */
export async function disableReminders(sourceId: string): Promise<boolean> {
  const removed = await api("/api/push/unregister/", { sourceId });
  try {
    const registration = await navigator.serviceWorker?.getRegistration(SW_SCOPE);
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // The server side is what stops reminders; a local unsubscribe is tidiness.
  }
  return removed;
}

/**
 * On sign-out, before the session ends: a token left registered would keep
 * sending this account's reminders to a browser someone else may now use
 * (SECURITY §8). Best effort — sign-out never waits on it failing.
 */
export async function forgetThisDevice(): Promise<void> {
  const sourceId = installationId();
  if (!sourceId) return;
  try {
    await api("/api/push/unregister/", { sourceId });
  } catch {
    // Offline: the stale token is dropped the first time FCM reports it gone.
  }
}

/** This browser's install id, as the counter stored it. Null before the counter has run here. */
export function installationId(): string | null {
  try {
    const hot = JSON.parse(localStorage.getItem("njc.hot") ?? "null");
    return typeof hot?.sourceId === "string" && hot.sourceId ? hot.sourceId : null;
  } catch {
    return null;
  }
}
