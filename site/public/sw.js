/*
 * Offline for the installed app (#31).
 *
 * The counter needs no network, but the installed app opened to the browser's
 * "No internet" page. This keeps the last good copy of the counter pages and
 * their assets:
 *
 *   pages      network first, so a new deploy is picked up whenever online; the
 *              cached copy only when the network fails
 *   /_next/static/   cache first — every file there has a content hash in its
 *              name, so a cached one can never be stale
 *
 * Sign-in, account, admin and every API are never touched: they must always be
 * live. Firebase's messaging worker keeps its own narrower scope.
 */
const CACHE = "tc-offline-v1";
const PAGES = ["/", "/streak/", "/stats/"];
const NEVER = /^\/(api|auth|account|admin|login)(\/|$)/;
/* B42: every deploy adds its own hashed files and nothing took the old ones out.
   Past this many, the oldest are dropped (one deploy is well under a hundred). */
const STATIC_MAX = 250;

function trimStatic(cache) {
  return cache.keys().then((keys) => {
    const statics = keys.filter((k) => new URL(k.url).pathname.startsWith("/_next/static/"));
    const extra = statics.length - STATIC_MAX;
    return extra > 0 ? Promise.all(statics.slice(0, extra).map((k) => cache.delete(k))) : null;
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PAGES))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NEVER.test(url.pathname)) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy).then(() => trimStatic(c)));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate" && PAGES.includes(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() => caches.match(url.pathname).then((hit) => hit || caches.match("/"))),
    );
  }
});
