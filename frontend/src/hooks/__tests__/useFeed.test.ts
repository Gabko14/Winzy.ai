import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useFeed } from "../useFeed";

jest.mock("../../api/feed", () => ({
  fetchFeed: jest.fn(),
}));

const { fetchFeed } = jest.requireMock("../../api/feed");

const makeFeedEntry = (id: string) => ({
  id,
  actorId: `actor-${id}`,
  eventType: "habit.completed" as const,
  data: { habitName: "Exercise" },
  createdAt: "2026-03-15T10:00:00Z",
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useFeed", () => {
  // --- Happy path ---

  it("loads initial page on mount", async () => {
    fetchFeed.mockResolvedValue({
      items: [makeFeedEntry("1"), makeFeedEntry("2")],
      nextCursor: "cursor-1",
      hasMore: true,
    });

    const { result } = renderHook(() => useFeed());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].id).toBe("1");
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeNull();
    expect(fetchFeed).toHaveBeenCalledWith(undefined, 20);
  });

  it("respects custom limit parameter", async () => {
    fetchFeed.mockResolvedValue({
      items: [makeFeedEntry("1")],
      nextCursor: null,
      hasMore: false,
    });

    renderHook(() => useFeed(5));

    await waitFor(() => {
      expect(fetchFeed).toHaveBeenCalledWith(undefined, 5);
    });
  });

  it("loadMore appends next page using cursor", async () => {
    fetchFeed
      .mockResolvedValueOnce({
        items: [makeFeedEntry("1"), makeFeedEntry("2")],
        nextCursor: "cursor-1",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [makeFeedEntry("3")],
        nextCursor: null,
        hasMore: false,
      });

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);

    await act(async () => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.loadingMore).toBe(false);
    });

    expect(result.current.items).toHaveLength(3);
    expect(result.current.items[2].id).toBe("3");
    expect(result.current.hasMore).toBe(false);
    expect(fetchFeed).toHaveBeenCalledWith("cursor-1", 20);
  });

  it("sets loadingMore during pagination", async () => {
    let resolveSecond!: (value: unknown) => void;
    fetchFeed
      .mockResolvedValueOnce({
        items: [makeFeedEntry("1")],
        nextCursor: "cursor-1",
        hasMore: true,
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.loadingMore).toBe(true);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSecond({
        items: [makeFeedEntry("2")],
        nextCursor: null,
        hasMore: false,
      });
    });

    expect(result.current.loadingMore).toBe(false);
  });

  it("refresh replaces items with fresh data", async () => {
    fetchFeed
      .mockResolvedValueOnce({
        items: [makeFeedEntry("1")],
        nextCursor: "cursor-1",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [makeFeedEntry("new-1"), makeFeedEntry("new-2")],
        nextCursor: "cursor-2",
        hasMore: true,
      });

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items[0].id).toBe("1");

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].id).toBe("new-1");
  });

  // --- Edge cases ---

  it("handles empty feed", async () => {
    fetchFeed.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("loadMore is a no-op when hasMore is false", async () => {
    fetchFeed.mockResolvedValue({
      items: [makeFeedEntry("1")],
      nextCursor: null,
      hasMore: false,
    });

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    fetchFeed.mockClear();

    act(() => {
      result.current.loadMore();
    });

    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it("loadMore is a no-op when already loading more", async () => {
    let resolveSecond!: (value: unknown) => void;
    fetchFeed
      .mockResolvedValueOnce({
        items: [makeFeedEntry("1")],
        nextCursor: "cursor-1",
        hasMore: true,
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.loadingMore).toBe(true);

    // Second loadMore while first is in flight — should not fire another call
    fetchFeed.mockClear();
    act(() => {
      result.current.loadMore();
    });

    expect(fetchFeed).not.toHaveBeenCalled();

    // Cleanup
    await act(async () => {
      resolveSecond({
        items: [],
        nextCursor: null,
        hasMore: false,
      });
    });
  });

  it("loadMore is a no-op when nextCursor is null", async () => {
    fetchFeed.mockResolvedValue({
      items: [makeFeedEntry("1")],
      nextCursor: null,
      hasMore: true, // hasMore true but no cursor — edge case
    });

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    fetchFeed.mockClear();

    act(() => {
      result.current.loadMore();
    });

    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it("ignores state updates after unmount", async () => {
    let resolveLoad!: (value: unknown) => void;
    fetchFeed.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useFeed());

    expect(result.current.loading).toBe(true);

    unmount();

    // Resolve after unmount — should not throw
    resolveLoad({
      items: [makeFeedEntry("1")],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("handles feed entries with null data", async () => {
    const entry = { ...makeFeedEntry("1"), data: null };
    fetchFeed.mockResolvedValue({
      items: [entry],
      nextCursor: null,
      hasMore: false,
    });

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items[0].data).toBeNull();
  });

  // --- Error conditions ---

  it("sets error on initial load failure", async () => {
    const apiError = {
      status: 500,
      code: "server_error",
      message: "Internal error",
    };
    fetchFeed.mockRejectedValue(apiError);

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.items).toEqual([]);
  });

  it("sets error on loadMore failure without clearing existing items", async () => {
    const apiError = {
      status: 0,
      code: "network",
      message: "Network error",
    };
    fetchFeed
      .mockResolvedValueOnce({
        items: [makeFeedEntry("1"), makeFeedEntry("2")],
        nextCursor: "cursor-1",
        hasMore: true,
      })
      .mockRejectedValueOnce(apiError);

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);

    await act(async () => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.loadingMore).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
    // Existing items preserved
    expect(result.current.items).toHaveLength(2);
  });

  it("clears error on successful refresh after error", async () => {
    const apiError = {
      status: 500,
      code: "server_error",
      message: "Oops",
    };
    fetchFeed
      .mockRejectedValueOnce(apiError)
      .mockResolvedValueOnce({
        items: [makeFeedEntry("1")],
        nextCursor: null,
        hasMore: false,
      });

    const { result } = renderHook(() => useFeed());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });

  it("ignores error after unmount", async () => {
    let rejectLoad!: (reason: unknown) => void;
    fetchFeed.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
    );

    const { unmount } = renderHook(() => useFeed());

    unmount();

    // Reject after unmount — should not throw
    rejectLoad({
      status: 500,
      code: "server_error",
      message: "Crash",
    });
  });
});
