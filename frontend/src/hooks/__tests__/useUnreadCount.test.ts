import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useUnreadCount } from "../useUnreadCount";

jest.mock("../../api/notifications", () => ({
  fetchUnreadCount: jest.fn(),
}));

const { fetchUnreadCount } = jest.requireMock("../../api/notifications");

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useUnreadCount", () => {
  it("fetches count on mount", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 5 });

    const { result } = renderHook(() => useUnreadCount());

    await waitFor(() => {
      expect(result.current.count).toBe(5);
    });

    expect(fetchUnreadCount).toHaveBeenCalledTimes(1);
  });

  it("returns 0 on fetch error", async () => {
    fetchUnreadCount.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useUnreadCount());

    // Should stay at 0 (initial), not crash
    await waitFor(() => {
      expect(result.current.count).toBe(0);
    });
  });

  it("decrementBy reduces count locally", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 5 });

    const { result } = renderHook(() => useUnreadCount());

    await waitFor(() => {
      expect(result.current.count).toBe(5);
    });

    act(() => {
      result.current.decrementBy(1);
    });

    expect(result.current.count).toBe(4);
  });

  it("decrementBy does not go below zero", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 1 });

    const { result } = renderHook(() => useUnreadCount());

    await waitFor(() => {
      expect(result.current.count).toBe(1);
    });

    act(() => {
      result.current.decrementBy(5);
    });

    expect(result.current.count).toBe(0);
  });

  it("resetToZero sets count to 0", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 10 });

    const { result } = renderHook(() => useUnreadCount());

    await waitFor(() => {
      expect(result.current.count).toBe(10);
    });

    act(() => {
      result.current.resetToZero();
    });

    expect(result.current.count).toBe(0);
  });

  it("polls on interval", async () => {
    fetchUnreadCount
      .mockResolvedValueOnce({ unreadCount: 2 })
      .mockResolvedValueOnce({ unreadCount: 3 });

    renderHook(() => useUnreadCount());

    // Initial fetch
    await waitFor(() => {
      expect(fetchUnreadCount).toHaveBeenCalledTimes(1);
    });

    // Advance past poll interval (30s)
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(fetchUnreadCount).toHaveBeenCalledTimes(2);
  });

  it("refresh triggers immediate fetch", async () => {
    fetchUnreadCount
      .mockResolvedValueOnce({ unreadCount: 2 })
      .mockResolvedValueOnce({ unreadCount: 7 });

    const { result } = renderHook(() => useUnreadCount());

    await waitFor(() => {
      expect(result.current.count).toBe(2);
    });

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.count).toBe(7);
    });
  });
});
