// Network-first service worker: always prefers a fresh fetch (so deploys
// show up immediately, same reasoning as the ?v= cache-busting on scripts),
// and only falls back to the cached copy when there's no network at all.
const CACHE_NAME = "vocab-app-shell-v1";
const APP_SHELL = ["./", "./index.html", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  // Deliberately no self.skipWaiting() here — it used to swap the active
  // worker out from under an already-open tab with no visible signal, so an
  // "update" silently did nothing until the page happened to reload. Now the
  // new worker sits in "waiting" until the page's update banner asks for it.
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  // cache: "no-store" here is load-bearing — without it this "network-first"
  // fetch still quietly resolves from the browser's own HTTP cache (GitHub
  // Pages sends Cache-Control: max-age=600 on index.html, which has no ?v=
  // busting since it's the entry file itself), so a deploy could sit
  // invisible for up to 10 minutes even though this handler ran fresh.
  event.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
