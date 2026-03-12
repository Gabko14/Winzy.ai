/* global self, caches, fetch, Response, URL */

/**
 * Winzy.ai Service Worker
 *
 * Minimal offline shell strategy:
 * - Cache the app shell (HTML, JS, CSS) on install
 * - Serve from cache when offline, fall back to network
 * - Route fallback: serve index.html for SPA navigation requests
 *
 * Push notifications:
 * - Listens for push events and displays notifications
 * - Handles notification click to focus/open the app
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

  // Skip all backend routes — server is source of truth.
  // These match the gateway's route prefixes.
  const url = new URL(request.url);
  const backendPrefixes = ["/auth/", "/habits", "/notifications", "/social", "/challenges", "/friends", "/health"];
  if (backendPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
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

// --- Push notification handling ---

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Non-JSON push — show a generic notification
    payload = {
      title: "Winzy.ai",
      body: event.data.text() || "You have a new notification",
    };
  }

  const title = payload.title || "Winzy.ai";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/assets/icon.png",
    badge: payload.badge || "/assets/favicon.png",
    data: {
      url: payload.url || "/",
    },
    // Vibrate gently — supportive, not alarming
    vibrate: [100, 50, 100],
    tag: payload.tag || "winzy-notification",
    // Replace existing notification with same tag
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // If the app is already open, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.focus();
          client.postMessage({ type: "NOTIFICATION_CLICK", url: targetUrl });
          return;
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(targetUrl);
    }),
  );
});
