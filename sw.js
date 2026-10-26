/* Life in Weeks offline support. Raw-image endpoints must bypass the app-shell cache. */
const CACHE = "life-in-weeks-v4-raw-jpeg";
const SHELL = ["./", "./index.html", "manifest.webmanifest", "icon.svg", "favicon-32.png", "icon-180.png", "icon-512.png"];
const RAW_IMAGE_PATHS = new Set(["/life", "/age", "/year", "/yearly", "/goal", "/goals", "/image", "/api/calendar"]);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (RAW_IMAGE_PATHS.has(url.pathname)) {
    // Never let a previously cached index.html replace the raw image response.
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request, { ignoreSearch: true }) ||
        (request.mode === "navigate" ? await cache.match(new URL("index.html", self.registration.scope).href) : null);
      const fresh = fetch(request)
        .then(response => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
