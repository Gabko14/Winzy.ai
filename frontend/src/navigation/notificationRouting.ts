import type { TabId } from "./TabBar";
import type { OverlayType } from "./useOverlayRouter";

export type NotificationDestination =
  | { kind: "tab"; tab: TabId }
  | { kind: "overlay"; overlay: Extract<OverlayType, "challenges"> };

/**
 * Maps push payload urls / ?notif= keys to an in-app destination.
 * Live payloads use /friends and /challenges (i1q6). Unknown -> Feed.
 */
export function resolveNotificationDestination(
  urlOrKey: string | null | undefined,
): NotificationDestination {
  const key = normalizeNotifKey(urlOrKey);
  if (key === "today" || key === "home" || key === "log") {
    return { kind: "tab", tab: "today" };
  }
  if (key === "profile" || key === "flame") {
    return { kind: "tab", tab: "profile" };
  }
  if (key === "friends" || key === "friend" || key === "friend_request") {
    return { kind: "tab", tab: "friends" };
  }
  if (key === "challenges" || key === "challenge") {
    return { kind: "overlay", overlay: "challenges" };
  }
  if (key === "feed" || key === "activity") {
    return { kind: "tab", tab: "feed" };
  }
  return { kind: "tab", tab: "feed" };
}

export function destinationToNotifQuery(dest: NotificationDestination): string {
  return dest.kind === "overlay" ? dest.overlay : dest.tab;
}

export function normalizeNotifKey(urlOrKey: string | null | undefined): string {
  if (!urlOrKey) return "";
  let raw = urlOrKey.trim();
  try {
    if (/^https?:\/\//i.test(raw)) {
      raw = new URL(raw).pathname;
    }
  } catch {
    // keep raw
  }
  const path = raw.split("?")[0]?.split("#")[0] ?? "";
  return path.replace(/^\//, "").toLowerCase();
}

/**
 * Reads ?notif= from a search string, returns destination, and optionally
 * cleans the URL via replaceState (same pattern as /@username CTA).
 */
export function consumeNotifSearchParam(
  search: string,
  replaceCleanUrl?: (nextUrl: string) => void,
  currentPathname = "/",
  currentHash = "",
): NotificationDestination | null {
  if (!search || search === "?") return null;
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const value = params.get("notif");
  if (!value) return null;

  params.delete("notif");
  const remaining = params.toString();
  const nextUrl =
    currentPathname + (remaining ? `?${remaining}` : "") + currentHash;
  replaceCleanUrl?.(nextUrl);

  return resolveNotificationDestination(value);
}
