import { Platform } from "react-native";
import {
  consumeNotifSearchParam,
  resolveNotificationDestination,
  type NotificationDestination,
} from "../navigation/notificationRouting";

export type NotificationNavHandler = (dest: NotificationDestination) => void;

type CaptureDeps = {
  addMessageListener?: (listener: (event: MessageEvent) => void) => void;
  removeMessageListener?: (listener: (event: MessageEvent) => void) => void;
  getSearch?: () => string;
  getPathname?: () => string;
  getHash?: () => string;
  replaceState?: (url: string) => void;
};

const pending: NotificationDestination[] = [];
let handler: NotificationNavHandler | null = null;
let started = false;
let messageListener: ((event: MessageEvent) => void) | null = null;
let activeDeps: CaptureDeps | null = null;

export function resetNotificationClickCaptureForTests() {
  pending.length = 0;
  handler = null;
  started = false;
  if (messageListener && activeDeps?.removeMessageListener) {
    activeDeps.removeMessageListener(messageListener);
  } else if (messageListener && typeof navigator !== "undefined" && navigator.serviceWorker) {
    navigator.serviceWorker.removeEventListener("message", messageListener as EventListener);
  }
  messageListener = null;
  activeDeps = null;
}

export function enqueueNotificationDestination(dest: NotificationDestination) {
  if (handler) {
    handler(dest);
    return;
  }
  pending.push(dest);
}

export function enqueueNotificationClickUrl(url: string | null | undefined) {
  enqueueNotificationDestination(resolveNotificationDestination(url));
}

/**
 * Subscribe to notification-click navigations. Replays any destinations
 * buffered before the app mounted.
 */
export function subscribeNotificationNavigation(
  next: NotificationNavHandler,
): () => void {
  handler = next;
  const queued = pending.splice(0, pending.length);
  for (const dest of queued) {
    next(dest);
  }
  return () => {
    if (handler === next) handler = null;
  };
}

/**
 * Starts warm-path SW message listening + cold-path ?notif= consumption.
 * Safe to call multiple times; idempotent. Call as early as possible on web.
 */
export function startNotificationClickCapture(deps: CaptureDeps = {}) {
  const harnessed =
    deps.addMessageListener != null ||
    deps.getSearch != null ||
    deps.replaceState != null;
  if (Platform.OS !== "web" && !harnessed) return;
  if (started) return;
  started = true;
  activeDeps = deps;

  const search =
    deps.getSearch?.() ??
    (typeof window !== "undefined" ? window.location?.search ?? "" : "");
  const pathname =
    deps.getPathname?.() ??
    (typeof window !== "undefined" ? window.location?.pathname ?? "/" : "/");
  const hash =
    deps.getHash?.() ??
    (typeof window !== "undefined" ? window.location?.hash ?? "" : "");

  const fromUrl = consumeNotifSearchParam(
    search,
    (nextUrl) => {
      if (deps.replaceState) {
        deps.replaceState(nextUrl);
      } else if (typeof window !== "undefined") {
        window.history.replaceState(window.history.state, "", nextUrl);
      }
    },
    pathname,
    hash,
  );
  if (fromUrl) {
    enqueueNotificationDestination(fromUrl);
  }

  messageListener = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if ((data as { type?: string }).type !== "NOTIFICATION_CLICK") return;
    enqueueNotificationClickUrl((data as { url?: string }).url);
  };

  if (deps.addMessageListener) {
    deps.addMessageListener(messageListener);
  } else if (typeof navigator !== "undefined" && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", messageListener);
  }
}
