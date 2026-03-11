import { Platform } from "react-native";

/**
 * Register the service worker on web.
 * Called once from App.tsx on mount.
 * No-op on native platforms.
 */
export function registerServiceWorker() {
  if (Platform.OS !== "web") return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("[SW] Registered with scope:", registration.scope);
      })
      .catch((error) => {
        console.error("[SW] Registration failed:", error);
      });
  });
}

/**
 * Inject the PWA manifest link tag on web.
 * Expo without expo-router doesn't have a custom +html.tsx,
 * so we inject the link tag at runtime.
 */
export function injectManifestLink() {
  if (Platform.OS !== "web") return;
  if (typeof document === "undefined") return;

  // Avoid duplicate
  if (document.querySelector('link[rel="manifest"]')) return;

  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = "/manifest.json";
  document.head.appendChild(link);

  // Theme color meta tag
  if (!document.querySelector('meta[name="theme-color"]')) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#F97316";
    document.head.appendChild(meta);
  }

  // Apple mobile web app capable
  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const meta = document.createElement("meta");
    meta.name = "apple-mobile-web-app-capable";
    meta.content = "yes";
    document.head.appendChild(meta);
  }

  // Apple status bar style
  if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
    const meta = document.createElement("meta");
    meta.name = "apple-mobile-web-app-status-bar-style";
    meta.content = "default";
    document.head.appendChild(meta);
  }

  // OG metadata for public flame pages
  injectMetaIfMissing("og:type", "website");
  injectMetaIfMissing("og:title", "Winzy.ai");
  injectMetaIfMissing("og:description", "Track your habits, grow your flame.");
  injectMetaIfMissing("og:site_name", "Winzy.ai");
}

function injectMetaIfMissing(property: string, content: string) {
  if (typeof document === "undefined") return;
  if (document.querySelector(`meta[property="${property}"]`)) return;

  const meta = document.createElement("meta");
  meta.setAttribute("property", property);
  meta.content = content;
  document.head.appendChild(meta);
}
