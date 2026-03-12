// Mock react-native Platform
let mockPlatformOS = "web";
jest.mock("react-native", () => ({
  Platform: { get OS() { return mockPlatformOS; } },
}));

// Mock the API module
jest.mock("../../api/push", () => ({
  registerDevice: jest.fn(),
  unregisterDevice: jest.fn(),
  fetchVapidPublicKey: jest.fn(),
}));

import {
  getPushPlatform,
  getPushPermissionStatus,
  subscribeToWebPush,
  unsubscribeFromWebPush,
  hasActiveWebPushSubscription,
} from "../push";
import {
  registerDevice,
  unregisterDevice,
  fetchVapidPublicKey,
} from "../../api/push";

const registerDeviceMock = registerDevice as jest.Mock;
const unregisterDeviceMock = unregisterDevice as jest.Mock;
const fetchVapidPublicKeyMock = fetchVapidPublicKey as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockPlatformOS = "web";
});

describe("getPushPlatform", () => {
  it("returns 'web_push' when running on web with Push API support", () => {
    mockPlatformOS = "web";
    Object.defineProperty(window, "PushManager", { value: {}, writable: true, configurable: true });
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve({}) },
      writable: true,
      configurable: true,
    });

    expect(getPushPlatform()).toBe("web_push");
  });

  it("returns 'unsupported' when PushManager is not available", () => {
    mockPlatformOS = "web";
    const original = (window as unknown as Record<string, unknown>).PushManager;
    delete (window as unknown as Record<string, unknown>).PushManager;

    expect(getPushPlatform()).toBe("unsupported");

    // Restore
    Object.defineProperty(window, "PushManager", { value: original, writable: true, configurable: true });
  });

  it("returns 'unsupported' on native platforms", () => {
    mockPlatformOS = "ios";
    expect(getPushPlatform()).toBe("unsupported");
  });

  it("returns 'unsupported' on Android (native not yet supported)", () => {
    mockPlatformOS = "android";
    expect(getPushPlatform()).toBe("unsupported");
  });
});

describe("getPushPermissionStatus", () => {
  it("returns current Notification.permission on web", () => {
    mockPlatformOS = "web";
    Object.defineProperty(global, "Notification", {
      value: { permission: "granted" },
      writable: true,
      configurable: true,
    });
    expect(getPushPermissionStatus()).toBe("granted");
  });

  it("returns 'unavailable' on native", () => {
    mockPlatformOS = "ios";
    expect(getPushPermissionStatus()).toBe("unavailable");
  });

  it("returns 'unavailable' when Notification is not defined", () => {
    mockPlatformOS = "web";
    const original = (global as unknown as Record<string, unknown>).Notification;
    delete (global as unknown as Record<string, unknown>).Notification;
    expect(getPushPermissionStatus()).toBe("unavailable");
    (global as unknown as Record<string, unknown>).Notification = original;
  });
});

describe("subscribeToWebPush", () => {
  const mockSubscription = {
    endpoint: "https://push.example.com/sub/abc123",
    toJSON: () => ({
      endpoint: "https://push.example.com/sub/abc123",
      keys: { p256dh: "key1", auth: "key2" },
    }),
    unsubscribe: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    mockPlatformOS = "web";
    Object.defineProperty(window, "PushManager", { value: {}, writable: true, configurable: true });
    Object.defineProperty(global, "Notification", {
      value: {
        permission: "default",
        requestPermission: jest.fn().mockResolvedValue("granted"),
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: jest.fn().mockResolvedValue(null),
            subscribe: jest.fn().mockResolvedValue(mockSubscription),
          },
        }),
      },
      writable: true,
      configurable: true,
    });
    fetchVapidPublicKeyMock.mockResolvedValue({ publicKey: "test-vapid-key" });
    registerDeviceMock.mockResolvedValue(undefined);
  });

  it("requests permission, subscribes, and registers with backend", async () => {
    const deviceId = await subscribeToWebPush();

    expect(Notification.requestPermission).toHaveBeenCalled();
    expect(fetchVapidPublicKeyMock).toHaveBeenCalled();
    expect(registerDeviceMock).toHaveBeenCalledWith({
      platform: "web_push",
      token: JSON.stringify(mockSubscription.toJSON()),
      deviceId: expect.any(String),
    });
    expect(deviceId).toBeTruthy();
    expect(deviceId).toMatch(/^web_/);
  });

  it("returns null and calls onPermissionDenied when permission denied", async () => {
    (Notification.requestPermission as jest.Mock).mockResolvedValue("denied");
    const onDenied = jest.fn();

    const result = await subscribeToWebPush(onDenied);

    expect(result).toBeNull();
    expect(onDenied).toHaveBeenCalled();
    expect(registerDeviceMock).not.toHaveBeenCalled();
  });

  it("returns null when permission is dismissed (not granted)", async () => {
    (Notification.requestPermission as jest.Mock).mockResolvedValue("default");

    const result = await subscribeToWebPush();

    expect(result).toBeNull();
    expect(registerDeviceMock).not.toHaveBeenCalled();
  });

  it("returns null on unsupported platform", async () => {
    mockPlatformOS = "ios";

    const result = await subscribeToWebPush();
    expect(result).toBeNull();
  });

  it("returns null when VAPID key fetch fails", async () => {
    fetchVapidPublicKeyMock.mockRejectedValue(new Error("Network error"));

    const result = await subscribeToWebPush();
    expect(result).toBeNull();
  });

  it("returns null when subscribe fails", async () => {
    const reg = await navigator.serviceWorker.ready;
    (reg.pushManager.subscribe as jest.Mock).mockRejectedValue(new Error("Subscribe failed"));

    const result = await subscribeToWebPush();
    expect(result).toBeNull();
  });

  it("reuses existing subscription instead of creating new one", async () => {
    const reg = await navigator.serviceWorker.ready;
    (reg.pushManager.getSubscription as jest.Mock).mockResolvedValue(mockSubscription);

    const deviceId = await subscribeToWebPush();

    expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
    expect(registerDeviceMock).toHaveBeenCalled();
    expect(deviceId).toBeTruthy();
  });
});

describe("unsubscribeFromWebPush", () => {
  const mockSubscription = {
    endpoint: "https://push.example.com/sub/abc123",
    unsubscribe: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    mockPlatformOS = "web";
    Object.defineProperty(window, "PushManager", { value: {}, writable: true, configurable: true });
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: jest.fn().mockResolvedValue(mockSubscription),
          },
        }),
      },
      writable: true,
      configurable: true,
    });
    unregisterDeviceMock.mockResolvedValue(undefined);
  });

  it("unsubscribes and removes device from backend", async () => {
    const result = await unsubscribeFromWebPush();

    expect(result).toBe(true);
    expect(mockSubscription.unsubscribe).toHaveBeenCalled();
    expect(unregisterDeviceMock).toHaveBeenCalledWith({
      deviceId: expect.stringMatching(/^web_/),
    });
  });

  it("returns true when no existing subscription", async () => {
    const reg = await navigator.serviceWorker.ready;
    (reg.pushManager.getSubscription as jest.Mock).mockResolvedValue(null);

    const result = await unsubscribeFromWebPush();
    expect(result).toBe(true);
    expect(unregisterDeviceMock).not.toHaveBeenCalled();
  });

  it("returns false on unsupported platform", async () => {
    mockPlatformOS = "android";

    const result = await unsubscribeFromWebPush();
    expect(result).toBe(false);
  });
});

describe("hasActiveWebPushSubscription", () => {
  it("returns true when subscription exists", async () => {
    mockPlatformOS = "web";
    Object.defineProperty(window, "PushManager", { value: {}, writable: true, configurable: true });
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: jest.fn().mockResolvedValue({ endpoint: "https://example.com" }),
          },
        }),
      },
      writable: true,
      configurable: true,
    });

    const result = await hasActiveWebPushSubscription();
    expect(result).toBe(true);
  });

  it("returns false when no subscription", async () => {
    mockPlatformOS = "web";
    Object.defineProperty(window, "PushManager", { value: {}, writable: true, configurable: true });
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: jest.fn().mockResolvedValue(null),
          },
        }),
      },
      writable: true,
      configurable: true,
    });

    const result = await hasActiveWebPushSubscription();
    expect(result).toBe(false);
  });

  it("returns false on unsupported platform", async () => {
    mockPlatformOS = "ios";

    const result = await hasActiveWebPushSubscription();
    expect(result).toBe(false);
  });
});
