import { renderHook, act } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { usePendingFriendCount } from "../usePendingFriendCount";

jest.mock("../../api/social", () => ({
  fetchPendingFriendCount: jest.fn(),
}));

const { fetchPendingFriendCount } = jest.requireMock("../../api/social");

type AppStateListener = (state: AppStateStatus) => void;

let appStateListener: AppStateListener;
const mockRemove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  // Capture the AppState listener registered by the hook
  jest.spyOn(AppState, "addEventListener").mockImplementation(
    (_type: string, listener: AppStateListener) => {
      appStateListener = listener;
      return { remove: mockRemove };
    },
  );
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function mockRequests(count: number) {
  fetchPendingFriendCount.mockResolvedValue({ count });
}

/** Flush microtasks so resolved promises settle under fake timers. */
async function flushPromises() {
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
}

describe("usePendingFriendCount", () => {
  // --- Happy path ---

  it("fetches pending count on mount", async () => {
    mockRequests(3);

    const { result } = renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(result.current.count).toBe(3);
    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);
  });

  it("exposes refresh that triggers immediate fetch", async () => {
    mockRequests(2);

    const { result } = renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(result.current.count).toBe(2);

    mockRequests(5);

    await act(async () => {
      result.current.refresh();
    });

    await flushPromises();

    expect(result.current.count).toBe(5);
  });

  it("polls every 30 seconds", async () => {
    mockRequests(1);

    renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    // Advance 30s — second poll
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(2);

    // Advance another 30s — third poll
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(3);
  });

  it("does not poll before 30 seconds", async () => {
    mockRequests(0);

    renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    // Advance 29s — should not have polled yet
    await act(async () => {
      jest.advanceTimersByTime(29_000);
    });

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);
  });

  // --- AppState logic ---

  it("pauses polling when app goes to background", async () => {
    mockRequests(1);

    renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    // Go to background
    act(() => {
      appStateListener("background");
    });

    // Advance 60s — polling should be paused
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    // Only the initial fetch, no interval polls
    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);
  });

  it("resumes polling and fires immediate fetch when app returns to foreground", async () => {
    mockRequests(1);

    renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    // Go to background then back to foreground
    act(() => {
      appStateListener("background");
    });

    mockRequests(4);

    await act(async () => {
      appStateListener("active");
    });

    await flushPromises();

    // Initial + immediate foreground fetch
    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(2);

    // Polling should resume — advance 30s
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(3);
  });

  it("does not restart interval if already active on foreground event", async () => {
    mockRequests(0);

    renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    // Fire foreground event without going to background first
    await act(async () => {
      appStateListener("active");
    });

    await flushPromises();

    // Immediate poll on foreground
    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(2);

    // Advance 30s — should only have one additional poll (not two intervals stacking)
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(3);
  });

  it("handles inactive AppState same as background", async () => {
    mockRequests(1);

    renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    // "inactive" state (e.g., app switcher on iOS)
    act(() => {
      appStateListener("inactive");
    });

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    // Only initial fetch, no polls
    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);
  });

  // --- Edge cases ---

  it("starts with count of 0", () => {
    fetchPendingFriendCount.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => usePendingFriendCount());

    expect(result.current.count).toBe(0);
  });

  it("reads count directly from response", async () => {
    fetchPendingFriendCount.mockResolvedValue({ count: 7 });

    const { result } = renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(result.current.count).toBe(7);
  });

  it("cleans up interval and AppState listener on unmount", async () => {
    mockRequests(0);

    const { unmount } = renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    unmount();

    expect(mockRemove).toHaveBeenCalledTimes(1);

    // Advance timers after unmount — no more polls
    fetchPendingFriendCount.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(fetchPendingFriendCount).not.toHaveBeenCalled();
  });

  // --- Error conditions ---

  it("silently ignores fetch errors — count stays at 0", async () => {
    fetchPendingFriendCount.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => usePendingFriendCount());

    await flushPromises();

    // Count should stay at 0, no crash
    expect(result.current.count).toBe(0);
  });

  it("recovers count after transient error", async () => {
    fetchPendingFriendCount
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ count: 1 });

    const { result } = renderHook(() => usePendingFriendCount());

    await flushPromises();

    expect(result.current.count).toBe(0);

    // Advance to next poll
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    expect(result.current.count).toBe(1);
  });

  it("does not update count after unmount even on success", async () => {
    let resolveRequest!: (value: unknown) => void;
    fetchPendingFriendCount.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const { unmount } = renderHook(() => usePendingFriendCount());

    unmount();

    // Resolve after unmount — should not throw or update state
    await act(async () => {
      resolveRequest({ count: 1 });
    });
  });

  // --- Auth-aware polling tests (winzy.ai-2pb1) ---

  it("does not poll when isAuthenticated is false", async () => {
    fetchPendingFriendCount.mockResolvedValue({ count: 5 });

    renderHook(() => usePendingFriendCount(false));

    await flushPromises();

    expect(fetchPendingFriendCount).not.toHaveBeenCalled();
  });

  it("resets count to 0 when isAuthenticated transitions to false", async () => {
    mockRequests(8);

    const { result, rerender } = renderHook(
      ({ authed }: { authed: boolean }) => usePendingFriendCount(authed),
      { initialProps: { authed: true } },
    );

    await flushPromises();

    expect(result.current.count).toBe(8);

    // Simulate logout
    rerender({ authed: false });

    expect(result.current.count).toBe(0);
  });

  it("stops polling when isAuthenticated becomes false", async () => {
    mockRequests(3);

    const { rerender } = renderHook(
      ({ authed }: { authed: boolean }) => usePendingFriendCount(authed),
      { initialProps: { authed: true } },
    );

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    fetchPendingFriendCount.mockClear();

    // Logout
    rerender({ authed: false });

    // Advance past poll interval — should not fire
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(fetchPendingFriendCount).not.toHaveBeenCalled();
  });

  it("fetches immediately when isAuthenticated transitions to true", async () => {
    fetchPendingFriendCount.mockResolvedValue({ count: 4 });

    const { result, rerender } = renderHook(
      ({ authed }: { authed: boolean }) => usePendingFriendCount(authed),
      { initialProps: { authed: false } },
    );

    expect(fetchPendingFriendCount).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);

    // Login
    rerender({ authed: true });

    await flushPromises();

    expect(result.current.count).toBe(4);
    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);
  });
});
