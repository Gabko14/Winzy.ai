import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useTodayHabits } from "../useTodayHabits";
import type { Habit, HabitStats } from "../../api/habits";

jest.mock("../../api/habits", () => ({
  fetchHabits: jest.fn(),
  fetchHabitStats: jest.fn(),
  completeHabit: jest.fn(),
  deleteCompletion: jest.fn(),
}));

// Also need to mock the isApiError import from types
jest.mock("../../api/types", () => ({
  isApiError: jest.fn((val: unknown) => {
    return (
      typeof val === "object" &&
      val !== null &&
      "status" in val &&
      "code" in val &&
      "message" in val
    );
  }),
}));

const { fetchHabits, fetchHabitStats, completeHabit, deleteCompletion } =
  jest.requireMock("../../api/habits");

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "h1",
    name: "Morning run",
    icon: null,
    color: null,
    frequency: "daily",
    customDays: null,
    createdAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
    ...overrides,
  };
}

function makeStats(overrides: Partial<HabitStats> = {}): HabitStats {
  return {
    habitId: "h1",
    consistency: 0.85,
    flameLevel: "steady",
    totalCompletions: 30,
    completionsInWindow: 20,
    completedToday: false,
    windowDays: 60,
    windowStart: "2026-01-14",
    today: "2026-03-14",
    completedDates: [],
    ...overrides,
  };
}

// Helper to set the day of week returned by new Date().getDay()
// 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
function mockDayOfWeek(dow: number) {
  const realDate = global.Date;
  const mockDate = new realDate(2026, 2, 8 + dow); // March 8 2026 is a Sunday
  jest.spyOn(global, "Date").mockImplementation((...args: unknown[]) => {
    if (args.length === 0) return mockDate;
    // @ts-expect-error -- constructor spread
    return new realDate(...args);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

// --- isDueToday (tested through the hook's filtering behavior) ---

describe("useTodayHabits — isDueToday filtering", () => {
  it("daily habits always show regardless of day", async () => {
    mockDayOfWeek(3); // Wednesday
    const daily = makeHabit({ id: "h1", frequency: "daily" });
    fetchHabits.mockResolvedValue([daily]);
    fetchHabitStats.mockResolvedValue(makeStats({ habitId: "h1" }));

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].habit.id).toBe("h1");
  });

  it("weekly habit shows on matching day-of-week", async () => {
    mockDayOfWeek(1); // Monday
    const weekly = makeHabit({
      id: "h2",
      frequency: "weekly",
      customDays: [1, 3, 5], // Mon, Wed, Fri
    });
    fetchHabits.mockResolvedValue([weekly]);
    fetchHabitStats.mockResolvedValue(makeStats({ habitId: "h2" }));

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
  });

  it("weekly habit excluded on non-matching day", async () => {
    mockDayOfWeek(2); // Tuesday
    const weekly = makeHabit({
      id: "h2",
      frequency: "weekly",
      customDays: [1, 3, 5], // Mon, Wed, Fri
    });
    fetchHabits.mockResolvedValue([weekly]);

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(0);
    // Stats should not be fetched for excluded habits
    expect(fetchHabitStats).not.toHaveBeenCalled();
  });

  it("custom frequency habit shows on matching day", async () => {
    mockDayOfWeek(6); // Saturday
    const custom = makeHabit({
      id: "h3",
      frequency: "custom",
      customDays: [0, 6], // Sun, Sat
    });
    fetchHabits.mockResolvedValue([custom]);
    fetchHabitStats.mockResolvedValue(makeStats({ habitId: "h3" }));

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
  });

  it("non-daily habit with null customDays is excluded", async () => {
    mockDayOfWeek(1);
    const weekly = makeHabit({
      id: "h2",
      frequency: "weekly",
      customDays: null,
    });
    fetchHabits.mockResolvedValue([weekly]);

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(0);
  });

  it("non-daily habit with empty customDays is excluded", async () => {
    mockDayOfWeek(1);
    const custom = makeHabit({
      id: "h3",
      frequency: "custom",
      customDays: [],
    });
    fetchHabits.mockResolvedValue([custom]);

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(0);
  });

  it("filters mixed habits correctly", async () => {
    mockDayOfWeek(1); // Monday
    const daily = makeHabit({ id: "h1", frequency: "daily" });
    const weeklyMatch = makeHabit({
      id: "h2",
      frequency: "weekly",
      customDays: [1, 3],
    });
    const weeklyNoMatch = makeHabit({
      id: "h3",
      frequency: "weekly",
      customDays: [2, 4],
    });
    const customMatch = makeHabit({
      id: "h4",
      frequency: "custom",
      customDays: [0, 1],
    });

    fetchHabits.mockResolvedValue([daily, weeklyMatch, weeklyNoMatch, customMatch]);
    fetchHabitStats.mockImplementation((id: string) =>
      Promise.resolve(makeStats({ habitId: id })),
    );

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should include h1 (daily), h2 (weekly Mon match), h4 (custom Mon match)
    // Should exclude h3 (weekly Tue/Thu — not Mon)
    expect(result.current.items).toHaveLength(3);
    const ids = result.current.items.map((i) => i.habit.id);
    expect(ids).toEqual(["h1", "h2", "h4"]);
  });
});

// --- Happy path ---

describe("useTodayHabits — loading and stats", () => {
  it("loads habits with stats on mount", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    const stats = makeStats({
      habitId: "h1",
      completedToday: true,
      flameLevel: "blazing",
      consistency: 0.95,
    });

    fetchHabits.mockResolvedValue([habit]);
    fetchHabitStats.mockResolvedValue(stats);

    const { result } = renderHook(() => useTodayHabits());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toEqual({
      habit,
      completedToday: true,
      flameLevel: "blazing",
      consistency: 0.95,
    });
    expect(result.current.completedCount).toBe(1);
    expect(result.current.totalCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("computes completedCount and totalCount correctly", async () => {
    mockDayOfWeek(1);
    const h1 = makeHabit({ id: "h1", frequency: "daily" });
    const h2 = makeHabit({ id: "h2", frequency: "daily" });
    const h3 = makeHabit({ id: "h3", frequency: "daily" });

    fetchHabits.mockResolvedValue([h1, h2, h3]);
    fetchHabitStats.mockImplementation((id: string) => {
      if (id === "h1") return Promise.resolve(makeStats({ habitId: "h1", completedToday: true }));
      if (id === "h2") return Promise.resolve(makeStats({ habitId: "h2", completedToday: true }));
      return Promise.resolve(makeStats({ habitId: id, completedToday: false }));
    });

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.completedCount).toBe(2);
    expect(result.current.totalCount).toBe(3);
  });

  it("refresh reloads habits", async () => {
    mockDayOfWeek(1);
    fetchHabits.mockResolvedValue([makeHabit({ id: "h1", frequency: "daily" })]);
    fetchHabitStats.mockResolvedValue(makeStats({ habitId: "h1" }));

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    fetchHabits.mockClear();
    fetchHabitStats.mockClear();

    fetchHabits.mockResolvedValue([
      makeHabit({ id: "h1", frequency: "daily" }),
      makeHabit({ id: "h2", frequency: "daily" }),
    ]);
    fetchHabitStats.mockImplementation((id: string) =>
      Promise.resolve(makeStats({ habitId: id })),
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.items).toHaveLength(2);
  });
});

// --- toggleCompletion ---

describe("useTodayHabits — toggleCompletion", () => {
  it("optimistically completes a habit", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    fetchHabits.mockResolvedValue([habit]);
    fetchHabitStats.mockResolvedValue(
      makeStats({ habitId: "h1", completedToday: false }),
    );
    completeHabit.mockResolvedValue({
      id: "c1",
      habitId: "h1",
      localDate: "2026-03-14",
      completedAt: "2026-03-14T10:00:00Z",
      consistency: 0.9,
    });

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items[0].completedToday).toBe(false);

    // After stats refresh
    fetchHabitStats.mockResolvedValue(
      makeStats({ habitId: "h1", completedToday: true, flameLevel: "strong" }),
    );

    await act(async () => {
      await result.current.toggleCompletion("h1");
    });

    expect(completeHabit).toHaveBeenCalledWith("h1", expect.objectContaining({ date: expect.any(String) }));
    expect(result.current.items[0].completedToday).toBe(true);
  });

  it("optimistically uncompletes a habit", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    fetchHabits.mockResolvedValue([habit]);
    fetchHabitStats.mockResolvedValue(
      makeStats({ habitId: "h1", completedToday: true }),
    );
    deleteCompletion.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items[0].completedToday).toBe(true);

    fetchHabitStats.mockResolvedValue(
      makeStats({ habitId: "h1", completedToday: false }),
    );

    await act(async () => {
      await result.current.toggleCompletion("h1");
    });

    expect(deleteCompletion).toHaveBeenCalled();
    expect(result.current.items[0].completedToday).toBe(false);
  });

  it("reverts optimistic update on API failure", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    fetchHabits.mockResolvedValue([habit]);
    fetchHabitStats.mockResolvedValue(
      makeStats({ habitId: "h1", completedToday: false }),
    );
    completeHabit.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Server error",
    });

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleCompletion("h1");
    });

    // Should revert to false
    expect(result.current.items[0].completedToday).toBe(false);
  });

  it("handles 409 conflict on complete — keeps completedToday true", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    fetchHabits.mockResolvedValue([habit]);
    fetchHabitStats.mockResolvedValue(
      makeStats({ habitId: "h1", completedToday: false }),
    );
    completeHabit.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "Already completed",
    });

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleCompletion("h1");
    });

    // 409 means already completed — state should be true (not reverted)
    expect(result.current.items[0].completedToday).toBe(true);
  });

  it("handles 404 on uncomplete — keeps completedToday false", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    fetchHabits.mockResolvedValue([habit]);
    fetchHabitStats.mockResolvedValue(
      makeStats({ habitId: "h1", completedToday: true }),
    );
    deleteCompletion.mockRejectedValue({
      status: 404,
      code: "not_found",
      message: "Not found",
    });

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleCompletion("h1");
    });

    // 404 means already uncompleted — state should be false (not reverted)
    expect(result.current.items[0].completedToday).toBe(false);
  });

  it("does nothing for unknown habitId", async () => {
    mockDayOfWeek(1);
    fetchHabits.mockResolvedValue([makeHabit({ id: "h1", frequency: "daily" })]);
    fetchHabitStats.mockResolvedValue(makeStats({ habitId: "h1" }));

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleCompletion("nonexistent");
    });

    expect(completeHabit).not.toHaveBeenCalled();
    expect(deleteCompletion).not.toHaveBeenCalled();
  });
});

// --- Error conditions ---

describe("useTodayHabits — error conditions", () => {
  it("sets error when fetchHabits fails", async () => {
    const apiError = { status: 500, code: "server_error", message: "Internal error" };
    fetchHabits.mockRejectedValue(apiError);

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.items).toEqual([]);
  });

  it("gracefully handles individual fetchHabitStats failure (Promise.allSettled)", async () => {
    mockDayOfWeek(1);
    const h1 = makeHabit({ id: "h1", frequency: "daily" });
    const h2 = makeHabit({ id: "h2", frequency: "daily" });

    fetchHabits.mockResolvedValue([h1, h2]);
    fetchHabitStats.mockImplementation((id: string) => {
      if (id === "h1") return Promise.resolve(makeStats({ habitId: "h1", completedToday: true }));
      // h2 stats fail
      return Promise.reject({ status: 500, code: "server_error", message: "Stats error" });
    });

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should still load both habits — failed stats get defaults
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].completedToday).toBe(true);
    // h2 gets default values since stats failed
    expect(result.current.items[1].completedToday).toBe(false);
    expect(result.current.items[1].flameLevel).toBe("none");
    expect(result.current.items[1].consistency).toBe(0);
    // No top-level error since fetchHabits succeeded
    expect(result.current.error).toBeNull();
  });

  it("handles empty habits list", async () => {
    fetchHabits.mockResolvedValue([]);

    const { result } = renderHook(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.completedCount).toBe(0);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.error).toBeNull();
  });
});
