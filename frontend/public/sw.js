/**
 * Winzy.ai Service Worker
 *
 * Minimal offline shell strategy:
 * - Cache the app shell (HTML, JS, CSS) on install
 * - Serve from cache when offline, fall back to network
 * - Route fallback: serve index.html for SPA navigation requests
 *
 * Server is the source of truth — this is NOT offline-first sync.
 */

const CACHE_NAME = "winzy-shell-v1";

// App shell assets to precache
const SHELL_ASSETS = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  // Clean up old caches
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // Skip API requests — server is source of truth
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return;
  }

  // Navigation requests: network-first with fallback to cached index.html (SPA routing)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/").then((cached) => cached || new Response("Offline", { status: 503 }))),
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache successful responses for static assets
        if (response.ok && (url.pathname.match(/\.(js|css|png|jpg|svg|woff2?)$/) || url.pathname === "/manifest.json")) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    }),
  );
});
