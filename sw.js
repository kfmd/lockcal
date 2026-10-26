/* Life in Weeks: offline support.
   Calendar data stays in the browser's local storage; generated JPGs are rendered in-page. */
const CACHE = "life-in-weeks-v4";
const SHELL = ["./", "./index.html", "manifest.webmanifest", "icon.svg", "favicon-32.png", "icon-180.png", "icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // Ignore query strings for precached assets, but retain the full request URL
      // when caching rendered routes so each URL-driven image can be reopened offline.
      const cached = await cache.match(request, { ignoreSearch: true }) ||
        (request.mode === "navigate" ? await cache.match(new URL("index.html", self.registration.scope).href) : null);
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
