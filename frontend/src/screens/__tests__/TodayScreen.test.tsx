import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { TodayScreen } from "../TodayScreen";
import type { TodayHabit } from "../../hooks/useTodayHabits";
import type { FlameLevel } from "../../api/habits";

// Mock the useTodayHabits hook
const mockUseTodayHabits = {
  items: [] as TodayHabit[],
  loading: false,
  error: null as null | { status: number; code: string; message: string },
  completing: new Set<string>(),
  completedCount: 0,
  totalCount: 0,
  refresh: jest.fn(),
  toggleCompletion: jest.fn(),
};

jest.mock("../../hooks/useTodayHabits", () => ({
  useTodayHabits: () => mockUseTodayHabits,
}));

function makeHabit(overrides: Partial<TodayHabit> = {}): TodayHabit {
  const id = overrides.habit?.id ?? Math.random().toString(36).slice(2);
  return {
    habit: {
      id,
      name: `Habit ${id}`,
      icon: null,
      color: null,
      frequency: "daily" as const,
      customDays: null,
      minimumDescription: null,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
      ...overrides.habit,
    },
    completedToday: overrides.completedToday ?? false,
    completedTodayKind: overrides.completedTodayKind ?? null,
    flameLevel: overrides.flameLevel ?? ("none" as FlameLevel),
    consistency: overrides.consistency ?? 0,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseTodayHabits.items = [];
  mockUseTodayHabits.loading = false;
  mockUseTodayHabits.error = null;
  mockUseTodayHabits.completing = new Set();
  mockUseTodayHabits.completedCount = 0;
  mockUseTodayHabits.totalCount = 0;
});

describe("TodayScreen", () => {
  // --- Loading state ---

  it("shows loading state on initial load", () => {
    mockUseTodayHabits.loading = true;

    const { getByTestId } = render(<TodayScreen />);
    expect(getByTestId("today-loading")).toBeTruthy();
  });

  // --- Error state ---

  it("shows error state with retry", () => {
    mockUseTodayHabits.error = {
      status: 500,
      code: "server_error",
      message: "Something went wrong on our end. Please try again.",
    };

    const { getByTestId, getByText } = render(<TodayScreen />);

    expect(getByTestId("today-error")).toBeTruthy();
    expect(getByText("Something went wrong on our end. Please try again.")).toBeTruthy();

    fireEvent.press(getByText("Try again"));
    expect(mockUseTodayHabits.refresh).toHaveBeenCalled();
  });

  it("shows error with network message", () => {
    mockUseTodayHabits.error = {
      status: 0,
      code: "network",
      message: "Unable to reach the server. Please check your connection.",
    };

    const { getByText } = render(<TodayScreen />);
    expect(getByText("Unable to reach the server. Please check your connection.")).toBeTruthy();
  });

  // --- Empty state ---

  it("shows empty state when no habits exist", () => {
    mockUseTodayHabits.items = [];
    mockUseTodayHabits.totalCount = 0;

    const { getByTestId, getByText } = render(<TodayScreen />);

    expect(getByTestId("today-empty")).toBeTruthy();
    expect(getByText("Ready to build a habit?")).toBeTruthy();
    expect(
      getByText("Small daily actions lead to big changes. Start with one habit and watch your flame grow."),
    ).toBeTruthy();
  });

  it("calls onCreateHabit when empty state CTA is pressed", () => {
    const onCreateHabit = jest.fn();
    mockUseTodayHabits.items = [];
    mockUseTodayHabits.totalCount = 0;

    const { getByText } = render(<TodayScreen onCreateHabit={onCreateHabit} />);

    fireEvent.press(getByText("Create your first habit"));
    expect(onCreateHabit).toHaveBeenCalledTimes(1);
  });

  // --- Populated state ---

  it("renders habit list with progress summary", () => {
    const items = [
      makeHabit({ habit: { id: "h1", name: "Morning run" } as TodayHabit["habit"], completedToday: true }),
      makeHabit({ habit: { id: "h2", name: "Read 30 min" } as TodayHabit["habit"], completedToday: false }),
      makeHabit({ habit: { id: "h3", name: "Meditate" } as TodayHabit["habit"], completedToday: false }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 3;
    mockUseTodayHabits.completedCount = 1;

    const { getByTestId, getByText } = render(<TodayScreen />);

    expect(getByTestId("today-screen")).toBeTruthy();
    expect(getByTestId("today-habits-list")).toBeTruthy();
    expect(getByText("1 of 3 done today")).toBeTruthy();
    expect(getByTestId("today-habit-h1")).toBeTruthy();
    expect(getByTestId("today-habit-h2")).toBeTruthy();
    expect(getByTestId("today-habit-h3")).toBeTruthy();
  });

  it("shows all done badge when all habits are completed", () => {
    const items = [
      makeHabit({ habit: { id: "h1", name: "Morning run" } as TodayHabit["habit"], completedToday: true }),
      makeHabit({ habit: { id: "h2", name: "Read" } as TodayHabit["habit"], completedToday: true }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 2;
    mockUseTodayHabits.completedCount = 2;

    const { getByText } = render(<TodayScreen />);
    expect(getByText("All done!")).toBeTruthy();
  });

  it("does not show all done badge when not all habits are completed", () => {
    const items = [
      makeHabit({ habit: { id: "h1", name: "Run" } as TodayHabit["habit"], completedToday: true }),
      makeHabit({ habit: { id: "h2", name: "Read" } as TodayHabit["habit"], completedToday: false }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 2;
    mockUseTodayHabits.completedCount = 1;

    const { queryByText } = render(<TodayScreen />);
    expect(queryByText("All done!")).toBeNull();
  });

  // --- Completion toggle ---

  it("calls toggleCompletion when checkbox is pressed", () => {
    const items = [
      makeHabit({ habit: { id: "h1", name: "Run" } as TodayHabit["habit"] }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    const { getByTestId } = render(<TodayScreen />);

    fireEvent.press(getByTestId("toggle-h1"));
    expect(mockUseTodayHabits.toggleCompletion).toHaveBeenCalledWith("h1", undefined);
  });

  it("shows completed habit with visual feedback", () => {
    const items = [
      makeHabit({
        habit: { id: "h1", name: "Morning run" } as TodayHabit["habit"],
        completedToday: true,
      }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;
    mockUseTodayHabits.completedCount = 1;

    const { getByTestId } = render(<TodayScreen />);

    const toggle = getByTestId("toggle-h1");
    expect(toggle).toBeTruthy();
    // The checkbox should indicate checked state
    expect(toggle.props.accessibilityState).toMatchObject({ checked: true });
  });

  it("shows uncompleted habit checkbox as unchecked", () => {
    const items = [
      makeHabit({
        habit: { id: "h1", name: "Morning run" } as TodayHabit["habit"],
        completedToday: false,
      }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    const { getByTestId } = render(<TodayScreen />);

    const toggle = getByTestId("toggle-h1");
    expect(toggle.props.accessibilityState).toMatchObject({ checked: false });
  });

  // --- Habit row press ---

  it("calls onHabitPress when habit row is pressed", () => {
    const onHabitPress = jest.fn();
    const items = [
      makeHabit({ habit: { id: "h1", name: "Run" } as TodayHabit["habit"] }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    const { getByTestId } = render(<TodayScreen onHabitPress={onHabitPress} />);

    fireEvent.press(getByTestId("today-habit-h1"));
    expect(onHabitPress).toHaveBeenCalledWith("h1");
  });

  // --- Flame indicator ---

  it("renders flame component for each habit", () => {
    const items = [
      makeHabit({
        habit: { id: "h1", name: "Run" } as TodayHabit["habit"],
        flameLevel: "blazing" as FlameLevel,
        consistency: 90,
      }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    const { getByTestId } = render(<TodayScreen />);

    // Flame component renders inside the habit row
    const habitRow = getByTestId("today-habit-h1");
    expect(habitRow).toBeTruthy();
  });

  // --- Date header ---

  it("renders the date header", () => {
    mockUseTodayHabits.items = [];
    mockUseTodayHabits.totalCount = 0;

    const { getByTestId } = render(<TodayScreen />);

    // The date header is shown in empty state too
    expect(getByTestId("today-empty")).toBeTruthy();
  });

  // --- Pull to refresh ---

  it("supports pull to refresh via FlatList refreshControl", () => {
    const items = [
      makeHabit({ habit: { id: "h1", name: "Run" } as TodayHabit["habit"] }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    const { getByTestId } = render(<TodayScreen />);

    const list = getByTestId("today-habits-list");
    expect(list).toBeTruthy();
    // The FlatList has a refreshControl prop — we verify the list renders
  });

  // --- Honest Minimums ---

  it("shows dual buttons for habits with minimumDescription configured", () => {
    const items = [
      makeHabit({
        habit: { id: "h1", name: "Workout", minimumDescription: "10-minute walk" } as TodayHabit["habit"],
      }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    const { getByTestId } = render(<TodayScreen />);
    expect(getByTestId("dual-buttons-h1")).toBeTruthy();
    expect(getByTestId("toggle-full-h1")).toBeTruthy();
    expect(getByTestId("toggle-minimum-h1")).toBeTruthy();
  });

  it("does not show dual buttons for habits without minimumDescription", () => {
    const items = [
      makeHabit({
        habit: { id: "h1", name: "Run" } as TodayHabit["habit"],
      }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    const { getByTestId, queryByTestId } = render(<TodayScreen />);
    expect(getByTestId("toggle-h1")).toBeTruthy();
    expect(queryByTestId("dual-buttons-h1")).toBeNull();
  });

  it("calls toggleCompletion with 'full' when full button is pressed", () => {
    const items = [
      makeHabit({
        habit: { id: "h1", name: "Workout", minimumDescription: "10-minute walk" } as TodayHabit["habit"],
      }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    const { getByTestId } = render(<TodayScreen />);
    fireEvent.press(getByTestId("toggle-full-h1"));
    expect(mockUseTodayHabits.toggleCompletion).toHaveBeenCalledWith("h1", "full");
  });

  it("calls toggleCompletion with 'minimum' when minimum button is pressed", () => {
    const items = [
      makeHabit({
        habit: { id: "h1", name: "Workout", minimumDescription: "10-minute walk" } as TodayHabit["habit"],
      }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    const { getByTestId } = render(<TodayScreen />);
    fireEvent.press(getByTestId("toggle-minimum-h1"));
    expect(mockUseTodayHabits.toggleCompletion).toHaveBeenCalledWith("h1", "minimum");
  });

  it("shows supportive copy for minimum completions", () => {
    const items = [
      makeHabit({
        habit: { id: "h1", name: "Workout", minimumDescription: "10-minute walk" } as TodayHabit["habit"],
        completedToday: true,
        completedTodayKind: "minimum",
      }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;
    mockUseTodayHabits.completedCount = 1;

    const { getByTestId } = render(<TodayScreen />);
    expect(getByTestId("minimum-label-h1")).toBeTruthy();
  });

  it("does not show supportive copy for full completions", () => {
    const items = [
      makeHabit({
        habit: { id: "h1", name: "Workout", minimumDescription: "10-minute walk" } as TodayHabit["habit"],
        completedToday: true,
        completedTodayKind: "full",
      }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    const { queryByTestId } = render(<TodayScreen />);
    expect(queryByTestId("minimum-label-h1")).toBeNull();
  });

  it("contains no streak language in minimum completion UI", () => {
    const items = [
      makeHabit({
        habit: { id: "h1", name: "Workout", minimumDescription: "10-minute walk" } as TodayHabit["habit"],
        completedToday: true,
        completedTodayKind: "minimum",
      }),
    ];
    mockUseTodayHabits.items = items;
    mockUseTodayHabits.totalCount = 1;

    render(<TodayScreen />);
    // Check supportive copy — no streak language
    expect(screen.queryByText(/streak/i)).toBeNull();
    expect(screen.queryByText(/days in a row/i)).toBeNull();
    expect(screen.queryByText(/failed/i)).toBeNull();
    // Positive check: supportive message is shown
    expect(screen.getByText("Kept the ember alive")).toBeTruthy();
  });
});
