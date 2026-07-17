import { act, waitFor } from "@testing-library/react-native";
import { useTodayHabits } from "../useTodayHabits";
import type {
  Habit,
  HabitStats,
  CompletionsRangeResponse,
  CompletionKind,
} from "../../api/habits";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";
import { addDaysISO } from "../../utils/completionCycle";

jest.mock("../../api/habits", () => ({
  fetchHabits: jest.fn(),
  fetchHabitStats: jest.fn(),
  fetchCompletionsRange: jest.fn(),
  completeHabit: jest.fn(),
  deleteCompletion: jest.fn(),
  updateCompletion: jest.fn(),
}));

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

const {
  fetchHabits,
  fetchHabitStats,
  fetchCompletionsRange,
  completeHabit,
  deleteCompletion,
  updateCompletion,
} = jest.requireMock("../../api/habits");

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "h1",
    name: "Morning run",
    icon: null,
    color: null,
    frequency: "daily",
    customDays: null,
    minimumDescription: null,
    position: 0,
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
    completedTodayKind: null,
    windowDays: 60,
    windowStart: "2026-01-14",
    today: "2026-03-09",
    completedDates: [],
    ...overrides,
  };
}

function makeRange(
  habits: Habit[],
  today: string,
  completedByHabit: Record<string, Partial<Record<string, CompletionKind | null>>> = {},
): CompletionsRangeResponse {
  const from = addDaysISO(today, -6);
  return {
    from,
    to: today,
    habits: habits.map((h) => {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const date = addDaysISO(today, -i);
        const kind = completedByHabit[h.id]?.[date] ?? null;
        days.push({ date, completed: kind != null, completionKind: kind });
      }
      return {
        id: h.id,
        name: h.name,
        icon: h.icon,
        color: h.color,
        frequency: h.frequency,
        customDays: h.customDays,
        minimumDescription: h.minimumDescription,
        days,
      };
    }),
  };
}

const RealDate = global.Date;

function mockDayOfWeek(dow: number) {
  const fixed = new RealDate(2026, 2, 8 + dow); // March 8 2026 is a Sunday
  const MockDate = function (this: Date, ...args: unknown[]) {
    if (args.length === 0) {
      return new RealDate(fixed.getTime());
    }
    // @ts-expect-error -- constructor spread
    return new RealDate(...args);
  } as unknown as DateConstructor;
  MockDate.now = RealDate.now.bind(RealDate);
  MockDate.UTC = RealDate.UTC.bind(RealDate);
  MockDate.parse = RealDate.parse.bind(RealDate);
  Object.defineProperty(MockDate, "prototype", {
    value: RealDate.prototype,
    writable: false,
  });
  global.Date = MockDate;
}

function todayISO(): string {
  // With mockDayOfWeek(1) → 2026-03-09
  return "2026-03-09";
}

function stubHappyPath(habits: Habit[], completedByHabit: Record<string, Partial<Record<string, CompletionKind | null>>> = {}) {
  const today = todayISO();
  fetchHabits.mockResolvedValue(habits);
  fetchHabitStats.mockImplementation((id: string) =>
    Promise.resolve(makeStats({ habitId: id })),
  );
  fetchCompletionsRange.mockResolvedValue(makeRange(habits, today, completedByHabit));
}

beforeEach(() => {
  jest.clearAllMocks();
  global.Date = RealDate;
});

afterEach(() => {
  global.Date = RealDate;
});

describe("useTodayHabits — isDueToday filtering", () => {
  it("daily habits always show regardless of day", async () => {
    mockDayOfWeek(3);
    const daily = makeHabit({ id: "h1", frequency: "daily" });
    stubHappyPath([daily]);
    // Override today for Wednesday mock (March 11)
    fetchCompletionsRange.mockResolvedValue(makeRange([daily], "2026-03-11"));

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].habit.id).toBe("h1");
  });

  it("weekly habit shows on matching day-of-week", async () => {
    mockDayOfWeek(1);
    const weekly = makeHabit({
      id: "h2",
      frequency: "weekly",
      customDays: [1, 3, 5],
    });
    stubHappyPath([weekly]);

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
  });

  it("weekly habit excluded on non-matching day", async () => {
    mockDayOfWeek(2);
    const weekly = makeHabit({
      id: "h2",
      frequency: "weekly",
      customDays: [1, 3, 5],
    });
    fetchHabits.mockResolvedValue([weekly]);
    fetchCompletionsRange.mockResolvedValue(makeRange([weekly], "2026-03-10"));

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(0);
    expect(fetchHabitStats).not.toHaveBeenCalled();
  });

  it("custom frequency habit shows on matching day", async () => {
    mockDayOfWeek(6);
    const custom = makeHabit({
      id: "h3",
      frequency: "custom",
      customDays: [0, 6],
    });
    stubHappyPath([custom]);
    fetchCompletionsRange.mockResolvedValue(makeRange([custom], "2026-03-14"));

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

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
    fetchCompletionsRange.mockResolvedValue(makeRange([], todayISO()));

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

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
    fetchCompletionsRange.mockResolvedValue(makeRange([], todayISO()));

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(0);
  });

  it("filters mixed habits correctly", async () => {
    mockDayOfWeek(1);
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

    const all = [daily, weeklyMatch, weeklyNoMatch, customMatch];
    fetchHabits.mockResolvedValue(all);
    fetchHabitStats.mockImplementation((id: string) =>
      Promise.resolve(makeStats({ habitId: id })),
    );
    fetchCompletionsRange.mockResolvedValue(makeRange(all, todayISO()));

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(3);
    const ids = result.current.items.map((i) => i.habit.id);
    expect(ids).toEqual(["h1", "h2", "h4"]);
  });
});

describe("useTodayHabits — loading and stats", () => {
  it("loads habits with range completion as source of truth", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    fetchHabits.mockResolvedValue([habit]);
    fetchHabitStats.mockResolvedValue(
      makeStats({
        habitId: "h1",
        completedToday: false, // stats lie — range wins
        flameLevel: "blazing",
        consistency: 0.95,
      }),
    );
    fetchCompletionsRange.mockResolvedValue(
      makeRange([habit], todayISO(), { h1: { [todayISO()]: "full" } }),
    );

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].completedToday).toBe(true);
    expect(result.current.items[0].completedTodayKind).toBe("full");
    expect(result.current.items[0].flameLevel).toBe("blazing");
    expect(result.current.items[0].consistency).toBe(0.95);
    expect(result.current.items[0].weekDays).toHaveLength(7);
    expect(result.current.completedCount).toBe(1);
    expect(result.current.totalCount).toBe(1);
    expect(result.current.error).toBeNull();
    expect(fetchCompletionsRange).toHaveBeenCalledTimes(1);
  });

  it("computes completedCount from range today cells", async () => {
    mockDayOfWeek(1);
    const h1 = makeHabit({ id: "h1", frequency: "daily" });
    const h2 = makeHabit({ id: "h2", frequency: "daily" });
    const h3 = makeHabit({ id: "h3", frequency: "daily" });
    const habits = [h1, h2, h3];
    fetchHabits.mockResolvedValue(habits);
    fetchHabitStats.mockImplementation((id: string) =>
      Promise.resolve(makeStats({ habitId: id })),
    );
    fetchCompletionsRange.mockResolvedValue(
      makeRange(habits, todayISO(), {
        h1: { [todayISO()]: "full" },
        h2: { [todayISO()]: "minimum" },
      }),
    );

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.completedCount).toBe(2);
    expect(result.current.totalCount).toBe(3);
  });

  it("refresh reloads habits and range", async () => {
    mockDayOfWeek(1);
    stubHappyPath([makeHabit({ id: "h1", frequency: "daily" })]);

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    fetchHabits.mockClear();
    fetchHabitStats.mockClear();
    fetchCompletionsRange.mockClear();

    const h1 = makeHabit({ id: "h1", frequency: "daily" });
    const h2 = makeHabit({ id: "h2", frequency: "daily" });
    fetchHabits.mockResolvedValue([h1, h2]);
    fetchHabitStats.mockImplementation((id: string) =>
      Promise.resolve(makeStats({ habitId: id })),
    );
    fetchCompletionsRange.mockResolvedValue(makeRange([h1, h2], todayISO()));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
  });
});

describe("useTodayHabits — toggleCompletion", () => {
  it("optimistically completes today via range cache", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    stubHappyPath([habit]);
    completeHabit.mockImplementation(async () => {
      fetchCompletionsRange.mockResolvedValue(
        makeRange([habit], todayISO(), { h1: { [todayISO()]: "full" } }),
      );
      return {
        id: "c1",
        habitId: "h1",
        localDate: todayISO(),
        completedAt: "2026-03-09T10:00:00Z",
        consistency: 0.9,
        completionKind: "full",
      };
    });

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items[0].completedToday).toBe(false);

    await act(async () => {
      await result.current.toggleCompletion("h1");
    });

    expect(completeHabit).toHaveBeenCalledWith(
      "h1",
      expect.objectContaining({ date: todayISO(), completionKind: "full" }),
    );
    await waitFor(() => {
      expect(result.current.items[0].completedToday).toBe(true);
    });
    expect(result.current.undo).toBeNull();
  });

  it("optimistically uncompletes today", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    stubHappyPath([habit], { h1: { [todayISO()]: "full" } });
    deleteCompletion.mockImplementation(async () => {
      fetchCompletionsRange.mockResolvedValue(makeRange([habit], todayISO()));
    });

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items[0].completedToday).toBe(true);

    await act(async () => {
      await result.current.toggleCompletion("h1");
    });

    expect(deleteCompletion).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.items[0].completedToday).toBe(false);
    });
  });

  it("reverts optimistic update on API failure", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    stubHappyPath([habit]);
    completeHabit.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Server error",
    });

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleCompletion("h1");
    });

    expect(result.current.items[0].completedToday).toBe(false);
  });

  it("handles 409 conflict on complete — keeps completedToday true", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    stubHappyPath([habit]);
    completeHabit.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "Already completed",
    });

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleCompletion("h1");
    });

    await waitFor(() => {
      expect(result.current.items[0].completedToday).toBe(true);
    });
  });

  it("handles 404 on uncomplete — keeps completedToday false", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    stubHappyPath([habit], { h1: { [todayISO()]: "full" } });
    deleteCompletion.mockRejectedValue({
      status: 404,
      code: "not_found",
      message: "Not found",
    });

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleCompletion("h1");
    });

    await waitFor(() => {
      expect(result.current.items[0].completedToday).toBe(false);
    });
  });

  it("does nothing for unknown habitId", async () => {
    mockDayOfWeek(1);
    stubHappyPath([makeHabit({ id: "h1", frequency: "daily" })]);

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

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

describe("useTodayHabits — toggleDay + undo", () => {
  it("cycles a past day and surfaces undo chip", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    stubHappyPath([habit]);
    completeHabit.mockImplementation(async () => {
      fetchCompletionsRange.mockResolvedValue(
        makeRange([habit], todayISO(), { h1: { "2026-03-08": "full" } }),
      );
      return {
        id: "c1",
        habitId: "h1",
        localDate: "2026-03-08",
        completedAt: "2026-03-08T10:00:00Z",
        consistency: 0.9,
        completionKind: "full",
      };
    });

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleDay("h1", "2026-03-08");
    });

    expect(completeHabit).toHaveBeenCalledWith(
      "h1",
      expect.objectContaining({ date: "2026-03-08", completionKind: "full" }),
    );
    await waitFor(() => {
      expect(result.current.undo).toMatchObject({
        habitId: "h1",
        date: "2026-03-08",
        previousKind: null,
      });
      const yesterday = result.current.items[0].weekDays.find((d) => d.date === "2026-03-08");
      expect(yesterday?.completed).toBe(true);
    });
  });

  it("undo reverts past-day completion via deleteCompletion", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({ id: "h1", frequency: "daily" });
    stubHappyPath([habit]);
    completeHabit.mockImplementation(async () => {
      fetchCompletionsRange.mockResolvedValue(
        makeRange([habit], todayISO(), { h1: { "2026-03-08": "full" } }),
      );
      return {
        id: "c1",
        habitId: "h1",
        localDate: "2026-03-08",
        completedAt: "2026-03-08T10:00:00Z",
        consistency: 0.9,
        completionKind: "full",
      };
    });
    deleteCompletion.mockImplementation(async () => {
      fetchCompletionsRange.mockResolvedValue(makeRange([habit], todayISO()));
    });

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleDay("h1", "2026-03-08");
    });

    await waitFor(() => {
      expect(result.current.undo).not.toBeNull();
    });

    await act(async () => {
      await result.current.undoLast();
    });

    expect(deleteCompletion).toHaveBeenCalledWith("h1", "2026-03-08");
    await waitFor(() => {
      expect(result.current.undo).toBeNull();
      const yesterday = result.current.items[0].weekDays.find((d) => d.date === "2026-03-08");
      expect(yesterday?.completed).toBe(false);
    });
  });

  it("cycles full → minimum on past day when habit has minimum", async () => {
    mockDayOfWeek(1);
    const habit = makeHabit({
      id: "h1",
      frequency: "daily",
      minimumDescription: "5 min",
    });
    stubHappyPath([habit], { h1: { "2026-03-08": "full" } });
    updateCompletion.mockResolvedValue({
      id: "c1",
      habitId: "h1",
      localDate: "2026-03-08",
      completedAt: "2026-03-08T10:00:00Z",
      consistency: 0.9,
      completionKind: "minimum",
    });

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleDay("h1", "2026-03-08");
    });

    expect(updateCompletion).toHaveBeenCalledWith("h1", "2026-03-08", "minimum");
  });
});

describe("useTodayHabits — error conditions", () => {
  it("sets error when fetchHabits fails", async () => {
    const apiError = { status: 500, code: "server_error", message: "Internal error" };
    fetchHabits.mockRejectedValue(apiError);

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.items).toEqual([]);
  });

  it("gracefully handles individual fetchHabitStats failure", async () => {
    mockDayOfWeek(1);
    const h1 = makeHabit({ id: "h1", frequency: "daily" });
    const h2 = makeHabit({ id: "h2", frequency: "daily" });

    fetchHabits.mockResolvedValue([h1, h2]);
    fetchHabitStats.mockImplementation((id: string) => {
      if (id === "h1") {
        return Promise.resolve(makeStats({ habitId: "h1" }));
      }
      return Promise.reject({ status: 500, code: "server_error", message: "Stats error" });
    });
    fetchCompletionsRange.mockResolvedValue(
      makeRange([h1, h2], todayISO(), { h1: { [todayISO()]: "full" } }),
    );

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].completedToday).toBe(true);
    expect(result.current.items[1].completedToday).toBe(false);
    expect(result.current.items[1].flameLevel).toBe("none");
    expect(result.current.items[1].consistency).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("handles empty habits list", async () => {
    fetchHabits.mockResolvedValue([]);
    fetchCompletionsRange.mockResolvedValue(makeRange([], todayISO()));

    const { result } = renderHookWithQueryClient(() => useTodayHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.completedCount).toBe(0);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.error).toBeNull();
  });
});
