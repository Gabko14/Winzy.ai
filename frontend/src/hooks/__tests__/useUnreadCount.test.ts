import { act } from "@testing-library/react-native";
import { useUnreadCount } from "../useUnreadCount";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";

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

async function flushPromises() {
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
}

describe("useUnreadCount", () => {
  it("fetches count on mount", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 5 });

    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await flushPromises();

    expect(result.current.count).toBe(5);
    expect(fetchUnreadCount).toHaveBeenCalledTimes(1);
  });

  it("returns 0 on fetch error", async () => {
    fetchUnreadCount.mockRejectedValue(new Error("Network error"));

    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await flushPromises();

    expect(result.current.count).toBe(0);
  });

  it("decrementBy reduces count locally", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 5 });

    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await flushPromises();

    act(() => {
      result.current.decrementBy(1);
    });

    expect(result.current.count).toBe(4);
  });

  it("decrementBy does not go below zero", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 1 });

    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await flushPromises();

    act(() => {
      result.current.decrementBy(5);
    });

    expect(result.current.count).toBe(0);
  });

  it("resetToZero sets count to 0", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 10 });

    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await flushPromises();

    act(() => {
      result.current.resetToZero();
    });

    expect(result.current.count).toBe(0);
  });

  it("polls on interval", async () => {
    fetchUnreadCount
      .mockResolvedValueOnce({ unreadCount: 2 })
      .mockResolvedValueOnce({ unreadCount: 3 });

    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await flushPromises();
    expect(fetchUnreadCount).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    expect(fetchUnreadCount).toHaveBeenCalledTimes(2);
    expect(result.current.count).toBe(3);
  });

  it("refresh triggers immediate fetch", async () => {
    fetchUnreadCount
      .mockResolvedValueOnce({ unreadCount: 2 })
      .mockResolvedValueOnce({ unreadCount: 7 });

    const { result } = renderHookWithQueryClient(() => useUnreadCount());

    await flushPromises();
    expect(result.current.count).toBe(2);

    await act(async () => {
      result.current.refresh();
    });
    await flushPromises();

    expect(result.current.count).toBe(7);
  });

  it("does not fetch when isAuthenticated is false", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 5 });

    const { result } = renderHookWithQueryClient(() => useUnreadCount(false));

    await flushPromises();

    expect(fetchUnreadCount).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });

  it("resets count to 0 when isAuthenticated transitions to false", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 8 });

    const { result, rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => useUnreadCount(authed),
      { initialProps: { authed: true } },
    );

    await flushPromises();
    expect(result.current.count).toBe(8);

    rerender({ authed: false });

    expect(result.current.count).toBe(0);
  });

  it("stops polling when isAuthenticated becomes false", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 3 });

    const { rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => useUnreadCount(authed),
      { initialProps: { authed: true } },
    );

    await flushPromises();
    expect(fetchUnreadCount).toHaveBeenCalledTimes(1);

    fetchUnreadCount.mockClear();
    rerender({ authed: false });

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(fetchUnreadCount).not.toHaveBeenCalled();
  });

  it("fetches immediately when isAuthenticated transitions to true", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 4 });

    const { result, rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => useUnreadCount(authed),
      { initialProps: { authed: false } },
    );

    await flushPromises();
    expect(fetchUnreadCount).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);

    rerender({ authed: true });
    await flushPromises();

    expect(fetchUnreadCount).toHaveBeenCalledTimes(1);
    expect(result.current.count).toBe(4);
  });

  it("refresh is a no-op when not authenticated", async () => {
    fetchUnreadCount.mockResolvedValue({ unreadCount: 5 });

    const { result } = renderHookWithQueryClient(() => useUnreadCount(false));

    await act(async () => {
      result.current.refresh();
    });
    await flushPromises();

    expect(fetchUnreadCount).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });
});
