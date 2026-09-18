/*
 * Reminders from Firebase Cloud Messaging.
 *
 * Deliberately without the Firebase SDK: the page registers this worker and hands
 * its registration to Firebase to obtain a token, and this worker only has to show
 * what arrives. No third-party script ever runs with a service worker's reach.
 *
 * A notification only ever opens a page on this site. A link in the payload that
 * points anywhere else is ignored and the home page opens instead.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const notification = payload.notification || {};
  const link =
    (payload.fcmOptions && payload.fcmOptions.link) ||
    (payload.webpush && payload.webpush.fcm_options && payload.webpush.fcm_options.link) ||
    (payload.data && payload.data.link) ||
    "/";

  event.waitUntil(
    self.registration.showNotification(String(notification.title || "Bhakti Nam Jap").slice(0, 120), {
      body: String(notification.body || "").slice(0, 240),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "bnj-reminder",
      data: { link: link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  let target;
  try {
    target = new URL((event.notification.data && event.notification.data.link) || "/", self.location.origin);
  } catch {
    target = new URL("/", self.location.origin);
  }
  if (target.origin !== self.location.origin) target = new URL("/", self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.focus().then((c) => (c && "navigate" in c ? c.navigate(target.href) : c));
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
