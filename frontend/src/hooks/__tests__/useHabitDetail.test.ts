import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useHabitDetail, useToggleCompletion } from "../useHabitDetail";

jest.mock("../../api/habits", () => ({
  fetchHabit: jest.fn(),
  fetchHabitStats: jest.fn(),
  completeHabit: jest.fn(),
  deleteCompletion: jest.fn(),
}));

const { fetchHabit, fetchHabitStats, completeHabit, deleteCompletion } =
  jest.requireMock("../../api/habits");

const mockHabit = {
  id: "h1",
  name: "Morning run",
  icon: "\uD83C\uDFC3",
  color: "#F97316",
  frequency: "daily" as const,
  customDays: null,
  minimumDescription: null,
  createdAt: "2026-01-01T00:00:00Z",
  archivedAt: null,
};

const mockStats = {
  totalCompletions: 42,
  currentStreak: 7,
  longestStreak: 14,
  completionsByDay: {},
};

beforeEach(() => {
  jest.clearAllMocks();
});

// --- useHabitDetail ---

describe("useHabitDetail", () => {
  it("loads habit and stats on mount", async () => {
    fetchHabit.mockResolvedValue(mockHabit);
    fetchHabitStats.mockResolvedValue(mockStats);

    const { result } = renderHook(() => useHabitDetail("h1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.habit).toEqual(mockHabit);
    expect(result.current.stats).toEqual(mockStats);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.timezone).toBe("string");
  });

  it("sets error on fetch failure", async () => {
    const apiError = { status: 500, code: "server_error", message: "Server error" };
    fetchHabit.mockRejectedValue(apiError);
    fetchHabitStats.mockRejectedValue(apiError);

    const { result } = renderHook(() => useHabitDetail("h1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.habit).toBeNull();
  });

  it("exposes a refresh function that reloads data", async () => {
    fetchHabit.mockResolvedValue(mockHabit);
    fetchHabitStats.mockResolvedValue(mockStats);

    const { result } = renderHook(() => useHabitDetail("h1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchHabit).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchHabit).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when habitId changes", async () => {
    fetchHabit.mockResolvedValue(mockHabit);
    fetchHabitStats.mockResolvedValue(mockStats);

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useHabitDetail(id),
      { initialProps: { id: "h1" } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender({ id: "h2" });

    await waitFor(() => {
      expect(fetchHabit).toHaveBeenCalledWith("h2");
    });
  });
});

// --- useToggleCompletion ---

describe("useToggleCompletion", () => {
  it("completes a habit and calls onSuccess", async () => {
    completeHabit.mockResolvedValue(undefined);
    const onSuccess = jest.fn();

    const { result } = renderHook(() =>
      useToggleCompletion("h1", "America/New_York", onSuccess),
    );

    expect(result.current.loading).toBe(false);

    await act(async () => {
      await result.current.complete("2026-03-20");
    });

    expect(completeHabit).toHaveBeenCalledWith("h1", {
      date: "2026-03-20",
      timezone: "America/New_York",
    });
    expect(onSuccess).toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("uncompletes a habit and calls onSuccess", async () => {
    deleteCompletion.mockResolvedValue(undefined);
    const onSuccess = jest.fn();

    const { result } = renderHook(() =>
      useToggleCompletion("h1", "UTC", onSuccess),
    );

    await act(async () => {
      await result.current.uncomplete("2026-03-20");
    });

    expect(deleteCompletion).toHaveBeenCalledWith("h1", "2026-03-20");
    expect(onSuccess).toHaveBeenCalled();
  });

  it("sets error on complete failure", async () => {
    const apiError = { status: 500, code: "server_error", message: "Failed" };
    completeHabit.mockRejectedValue(apiError);

    const { result } = renderHook(() =>
      useToggleCompletion("h1", "UTC"),
    );

    await act(async () => {
      try {
        await result.current.complete("2026-03-20");
      } catch {
        // expected — hook re-throws
      }
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.loading).toBe(false);
  });

  it("sets error on uncomplete failure", async () => {
    const apiError = { status: 404, code: "not_found", message: "Not found" };
    deleteCompletion.mockRejectedValue(apiError);

    const { result } = renderHook(() =>
      useToggleCompletion("h1", "UTC"),
    );

    await act(async () => {
      try {
        await result.current.uncomplete("2026-03-20");
      } catch {
        // expected — hook re-throws
      }
    });

    expect(result.current.error).toEqual(apiError);
  });
});
