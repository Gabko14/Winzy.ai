import { act } from "@testing-library/react-native";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";
import { usePendingFriendCount } from "../usePendingFriendCount";

jest.mock("../../api/social", () => ({
  fetchPendingFriendCount: jest.fn(),
}));

const { fetchPendingFriendCount } = jest.requireMock("../../api/social");

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
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
  it("fetches pending count on mount", async () => {
    mockRequests(3);

    const { result } = renderHookWithQueryClient(() => usePendingFriendCount());

    await flushPromises();

    expect(result.current.count).toBe(3);
    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);
  });

  it("exposes refresh that triggers immediate fetch", async () => {
    mockRequests(2);

    const { result } = renderHookWithQueryClient(() => usePendingFriendCount());

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

    renderHookWithQueryClient(() => usePendingFriendCount());

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(3);
  });

  it("does not poll before 30 seconds", async () => {
    mockRequests(0);

    renderHookWithQueryClient(() => usePendingFriendCount());

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(29_000);
    });

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);
  });

  it("starts with count of 0", () => {
    fetchPendingFriendCount.mockReturnValue(new Promise(() => {}));

    const { result } = renderHookWithQueryClient(() => usePendingFriendCount());

    expect(result.current.count).toBe(0);
  });

  it("reads count directly from response", async () => {
    fetchPendingFriendCount.mockResolvedValue({ count: 7 });

    const { result } = renderHookWithQueryClient(() => usePendingFriendCount());

    await flushPromises();

    expect(result.current.count).toBe(7);
  });

  it("stops polling after unmount", async () => {
    mockRequests(0);

    const { unmount } = renderHookWithQueryClient(() => usePendingFriendCount());

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    unmount();

    fetchPendingFriendCount.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(fetchPendingFriendCount).not.toHaveBeenCalled();
  });

  it("keeps count at 0 when fetch errors", async () => {
    fetchPendingFriendCount.mockRejectedValue(new Error("Network error"));

    const { result } = renderHookWithQueryClient(() => usePendingFriendCount());

    await flushPromises();

    expect(result.current.count).toBe(0);
  });

  it("recovers count after transient error", async () => {
    fetchPendingFriendCount
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ count: 1 });

    const { result } = renderHookWithQueryClient(() => usePendingFriendCount());

    await flushPromises();

    expect(result.current.count).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    expect(result.current.count).toBe(1);
  });

  it("does not poll when isAuthenticated is false", async () => {
    fetchPendingFriendCount.mockResolvedValue({ count: 5 });

    renderHookWithQueryClient(() => usePendingFriendCount(false));

    await flushPromises();

    expect(fetchPendingFriendCount).not.toHaveBeenCalled();
  });

  it("resets count to 0 when isAuthenticated transitions to false", async () => {
    mockRequests(8);

    const { result, rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => usePendingFriendCount(authed),
      { initialProps: { authed: true } },
    );

    await flushPromises();

    expect(result.current.count).toBe(8);

    rerender({ authed: false });

    expect(result.current.count).toBe(0);
  });

  it("stops polling when isAuthenticated becomes false", async () => {
    mockRequests(3);

    const { rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => usePendingFriendCount(authed),
      { initialProps: { authed: true } },
    );

    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);

    fetchPendingFriendCount.mockClear();

    rerender({ authed: false });

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(fetchPendingFriendCount).not.toHaveBeenCalled();
  });

  it("starts polling when isAuthenticated becomes true", async () => {
    mockRequests(2);

    const { result, rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => usePendingFriendCount(authed),
      { initialProps: { authed: false } },
    );

    await flushPromises();
    expect(fetchPendingFriendCount).not.toHaveBeenCalled();

    rerender({ authed: true });
    await flushPromises();

    expect(fetchPendingFriendCount).toHaveBeenCalledTimes(1);
    expect(result.current.count).toBe(2);
  });
});
