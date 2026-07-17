import {
  startNotificationClickCapture,
  subscribeNotificationNavigation,
  enqueueNotificationClickUrl,
  resetNotificationClickCaptureForTests,
} from "../notificationClicks";
import type { NotificationDestination } from "../../navigation/notificationRouting";

describe("notificationClicks buffer + capture", () => {
  beforeEach(() => {
    resetNotificationClickCaptureForTests();
  });

  it("buffers clicks that arrive before a subscriber mounts, then replays", () => {
    const seen: NotificationDestination[] = [];
    enqueueNotificationClickUrl("/friends");
    enqueueNotificationClickUrl("/challenges");

    const unsubscribe = subscribeNotificationNavigation((dest) => {
      seen.push(dest);
    });

    expect(seen).toEqual([
      { kind: "tab", tab: "friends" },
      { kind: "overlay", overlay: "challenges" },
    ]);
    unsubscribe();
  });

  it("delivers immediately once subscribed", () => {
    const seen: NotificationDestination[] = [];
    subscribeNotificationNavigation((dest) => {
      seen.push(dest);
    });
    enqueueNotificationClickUrl("/feed");
    expect(seen).toEqual([{ kind: "tab", tab: "feed" }]);
  });

  it("consumes cold-start ?notif= and cleans URL", () => {
    const seen: NotificationDestination[] = [];
    const replaced: string[] = [];
    const listeners: Array<(event: MessageEvent) => void> = [];

    startNotificationClickCapture({
      getSearch: () => "?notif=challenges",
      getPathname: () => "/",
      getHash: () => "",
      replaceState: (url) => replaced.push(url),
      addMessageListener: (listener) => listeners.push(listener),
      removeMessageListener: () => {},
    });

    subscribeNotificationNavigation((dest) => {
      seen.push(dest);
    });

    expect(seen).toEqual([{ kind: "overlay", overlay: "challenges" }]);
    expect(replaced).toEqual(["/"]);
    expect(listeners).toHaveLength(1);
  });

  it("routes warm-path NOTIFICATION_CLICK messages", () => {
    const seen: NotificationDestination[] = [];
    let listener: ((event: MessageEvent) => void) | null = null;

    startNotificationClickCapture({
      getSearch: () => "",
      addMessageListener: (l) => {
        listener = l;
      },
      removeMessageListener: () => {},
    });
    subscribeNotificationNavigation((dest) => {
      seen.push(dest);
    });

    listener!({
      data: { type: "NOTIFICATION_CLICK", url: "/friends" },
    } as MessageEvent);

    expect(seen).toEqual([{ kind: "tab", tab: "friends" }]);
  });

  it("ignores unrelated service worker messages", () => {
    const seen: NotificationDestination[] = [];
    let listener: ((event: MessageEvent) => void) | null = null;

    startNotificationClickCapture({
      getSearch: () => "",
      addMessageListener: (l) => {
        listener = l;
      },
      removeMessageListener: () => {},
    });
    subscribeNotificationNavigation((dest) => {
      seen.push(dest);
    });

    listener!({ data: { type: "OTHER", url: "/friends" } } as MessageEvent);
    expect(seen).toEqual([]);
  });
});
