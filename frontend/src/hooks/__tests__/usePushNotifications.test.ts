import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { PushPlatform } from "../../utils/push";

// Mock the push utils module
jest.mock("../../utils/push", () => ({
  getPushPlatform: jest.fn(),
  getPushPermissionStatus: jest.fn(),
  subscribeToWebPush: jest.fn(),
  unsubscribeFromWebPush: jest.fn(),
  hasActiveWebPushSubscription: jest.fn(),
}));

const {
  getPushPlatform,
  getPushPermissionStatus,
  subscribeToWebPush,
  unsubscribeFromWebPush,
  hasActiveWebPushSubscription,
} = jest.requireMock("../../utils/push");

// Import after mocks
import { usePushNotifications } from "../usePushNotifications";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("usePushNotifications", () => {
  it("reports 'unsupported' when platform has no push capability", async () => {
    getPushPlatform.mockReturnValue("unsupported" as PushPlatform);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsupported");
    });

    expect(result.current.platform).toBe("unsupported");
  });

  it("reports 'denied' when web push permission was previously denied", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("denied");

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("denied");
    });

    expect(result.current.platform).toBe("web_push");
  });

  it("reports 'subscribed' when existing web push subscription found", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("granted");
    hasActiveWebPushSubscription.mockResolvedValue(true);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("subscribed");
    });
  });

  it("reports 'unsubscribed' when no existing subscription", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockResolvedValue(false);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsubscribed");
    });
  });

  it("subscribe() transitions to 'subscribed' on success", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockResolvedValue(false);
    subscribeToWebPush.mockResolvedValue("web_12345");

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsubscribed");
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.status).toBe("subscribed");
    expect(result.current.subscribing).toBe(false);
  });

  it("subscribe() transitions to 'denied' when permission denied", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockResolvedValue(false);
    subscribeToWebPush.mockImplementation(async (onDenied: () => void) => {
      onDenied();
      return null;
    });

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsubscribed");
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.status).toBe("denied");
  });

  it("subscribe() stays 'unsubscribed' on failure (not denied)", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockResolvedValue(false);
    subscribeToWebPush.mockResolvedValue(null); // Failed but not denied

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsubscribed");
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.status).toBe("unsubscribed");
  });

  it("unsubscribe() transitions to 'unsubscribed'", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("granted");
    hasActiveWebPushSubscription.mockResolvedValue(true);
    unsubscribeFromWebPush.mockResolvedValue(true);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("subscribed");
    });

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(result.current.status).toBe("unsubscribed");
  });

  it("unsubscribe() does not change status on failure", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("granted");
    hasActiveWebPushSubscription.mockResolvedValue(true);
    unsubscribeFromWebPush.mockResolvedValue(false);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("subscribed");
    });

    await act(async () => {
      await result.current.unsubscribe();
    });

    // Status should remain subscribed since unsubscribe failed
    expect(result.current.status).toBe("subscribed");
  });

  it("starts in 'loading' status", () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockReturnValue(new Promise(() => {})); // Never resolves

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.status).toBe("loading");
  });

  // --- Error state tests ---

  it("error is null initially", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockResolvedValue(false);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsubscribed");
    });

    expect(result.current.error).toBeNull();
  });

  it("subscribe() sets error when subscription fails (not denied)", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockResolvedValue(false);
    subscribeToWebPush.mockResolvedValue(null); // Failed but not denied

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsubscribed");
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.error).toBe("Failed to enable push notifications. Please try again.");
    expect(result.current.status).toBe("unsubscribed");
  });

  it("subscribe() clears error on success", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockResolvedValue(false);

    // First call fails
    subscribeToWebPush.mockResolvedValueOnce(null);
    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsubscribed");
    });

    await act(async () => {
      await result.current.subscribe();
    });
    expect(result.current.error).toBeTruthy();

    // Second call succeeds
    subscribeToWebPush.mockResolvedValueOnce("web_12345");

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("subscribed");
  });

  it("unsubscribe() sets error on failure", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("granted");
    hasActiveWebPushSubscription.mockResolvedValue(true);
    unsubscribeFromWebPush.mockResolvedValue(false);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("subscribed");
    });

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(result.current.error).toBe("Failed to disable push notifications. Please try again.");
    expect(result.current.status).toBe("subscribed");
  });

  it("clearError() resets error to null", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockResolvedValue(false);
    subscribeToWebPush.mockResolvedValue(null);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsubscribed");
    });

    await act(async () => {
      await result.current.subscribe();
    });
    expect(result.current.error).toBeTruthy();

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it("subscribe() handles thrown errors gracefully", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockResolvedValue(false);
    subscribeToWebPush.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsubscribed");
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.subscribing).toBe(false);
    expect(result.current.error).toBe(
      "Failed to enable push notifications. Please try again."
    );
  });

  it("subscribe() does not set error when permission is denied", async () => {
    getPushPlatform.mockReturnValue("web_push" as PushPlatform);
    getPushPermissionStatus.mockReturnValue("default");
    hasActiveWebPushSubscription.mockResolvedValue(false);
    subscribeToWebPush.mockImplementation(async (onDenied: () => void) => {
      onDenied();
      return null;
    });

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.status).toBe("unsubscribed");
    });

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.status).toBe("denied");
    expect(result.current.error).toBeNull();
  });
});
