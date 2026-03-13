import { Platform } from "react-native";
import { registerDevice, unregisterDevice, fetchVapidPublicKey } from "../api/push";

// --- Platform Detection ---

export type PushPlatform = "web_push" | "expo_push" | "unsupported";

/**
 * Determine which push notification path is available on this platform.
 *
 * - web_push: Browser with Service Worker + Push API support
 * - expo_push: Native app via expo-notifications (not yet shipped)
 * - unsupported: No push capability (old browsers, SSR, etc.)
 */
export function getPushPlatform(): PushPlatform {
  if (Platform.OS === "web") {
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window
    ) {
      return "web_push";
    }
    return "unsupported";
  }

  // Native (iOS/Android) — expo-notifications integration not yet shipped.
  // When native apps are ready, this should check for expo-notifications availability.
  return "unsupported";
}

/**
 * Check if the browser/device has already granted push notification permission.
 */
export function getPushPermissionStatus(): NotificationPermission | "unavailable" {
  if (Platform.OS !== "web") return "unavailable";
  if (typeof Notification === "undefined") return "unavailable";
  return Notification.permission;
}

// --- Web Push Subscription ---

/**
 * Request push notification permission and subscribe to web push.
 * Returns the device ID (subscription endpoint hash) on success, or null on failure.
 *
 * @param onPermissionDenied - Called when the user explicitly blocks notifications.
 */
export async function subscribeToWebPush(
  onPermissionDenied?: () => void,
): Promise<string | null> {
  if (getPushPlatform() !== "web_push") {
    console.warn("[Push] Web push not supported on this platform");
    return null;
  }

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    console.info("[Push] Permission not granted:", permission);
    if (permission === "denied" && onPermissionDenied) {
      onPermissionDenied();
    }
    return null;
  }

  try {
    // Get VAPID public key from backend
    const { publicKey } = await fetchVapidPublicKey();

    // Get service worker registration
    const registration = await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Create new subscription
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      });
    }

    const subscriptionJson = JSON.stringify(subscription.toJSON());
    const deviceId = await deriveDeviceId(subscription.endpoint);

    // Register with backend
    await registerDevice({
      platform: "web_push",
      token: subscriptionJson,
      deviceId,
    });

    console.info("[Push] Web push subscription registered");
    return deviceId;
  } catch (error) {
    console.error("[Push] Failed to subscribe to web push:", error);
    return null;
  }
}

/**
 * Unsubscribe from web push notifications and remove the token from the backend.
 */
export async function unsubscribeFromWebPush(): Promise<boolean> {
  if (getPushPlatform() !== "web_push") return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const deviceId = await deriveDeviceId(subscription.endpoint);
      await subscription.unsubscribe();
      await unregisterDevice({ deviceId });
      console.info("[Push] Web push subscription removed");
    }

    return true;
  } catch (error) {
    console.error("[Push] Failed to unsubscribe from web push:", error);
    return false;
  }
}

/**
 * Check if the user currently has an active web push subscription.
 */
export async function hasActiveWebPushSubscription(): Promise<boolean> {
  if (getPushPlatform() !== "web_push") return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

// --- Helpers ---

/**
 * Convert a VAPID public key from URL-safe base64 to a Uint8Array.
 * Required by PushManager.subscribe().
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Derive a stable device ID from the push subscription endpoint URL.
 * Uses SHA-256 via Web Crypto (48-bit prefix). Falls back to a simple
 * 32-bit hash when crypto.subtle is unavailable (non-secure contexts).
 */
async function deriveDeviceId(endpoint: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(endpoint);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    const hex = Array.from(hashArray.slice(0, 6))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `web_${hex}`;
  }

  // Fallback: simple 32-bit hash for non-secure contexts
  let hash = 0;
  for (let i = 0; i < endpoint.length; i++) {
    hash = ((hash << 5) - hash + endpoint.charCodeAt(i)) | 0;
  }
  return `web_${Math.abs(hash).toString(36)}`;
}
