import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { MeditationLogSheet } from "../MeditationLogSheet";
import { _resetMeditationStorage, saveLastLoggedHabitId } from "../../utils/meditationPrefs";
import type { TodayHabit } from "../../hooks/useTodayHabits";

const mockToggleCompletion = jest.fn();
const mockUseTodayHabits = {
  items: [] as TodayHabit[],
  loading: false,
  toggleCompletion: mockToggleCompletion,
  completing: new Set<string>(),
  today: "2026-07-17",
};

jest.mock("../../hooks/useTodayHabits", () => ({
  useTodayHabits: () => mockUseTodayHabits,
}));

function makeItem(
  id: string,
  name: string,
  completedToday = false,
): TodayHabit {
  return {
    habit: {
      id,
      name,
      icon: null,
      color: null,
      frequency: "daily",
      customDays: null,
      minimumDescription: null,
      position: 0,
      createdAt: "2026-01-01T00:00:00Z",
      archivedAt: null,
    },
    completedToday,
    completedTodayKind: completedToday ? "full" : null,
    flameLevel: "none",
    consistency: 0,
    weekDays: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetMeditationStorage();
  mockUseTodayHabits.items = [];
  mockUseTodayHabits.loading = false;
  mockUseTodayHabits.completing = new Set();
  mockToggleCompletion.mockResolvedValue(undefined);
});

describe("MeditationLogSheet", () => {
  it("renders nothing when there are no due habits", async () => {
    mockUseTodayHabits.items = [];
    const { queryByTestId } = render(<MeditationLogSheet />);
    await act(async () => {});
    expect(queryByTestId("meditation-log-sheet")).toBeNull();
  });

  it("preselects last-used habit over name match", async () => {
    mockUseTodayHabits.items = [
      makeItem("run", "Morning run"),
      makeItem("med", "Meditate"),
    ];
    await saveLastLoggedHabitId("run");

    const { getByTestId } = render(<MeditationLogSheet />);
    await waitFor(() => {
      expect(getByTestId("meditation-log-sheet")).toBeTruthy();
    });

    // Selected indicator is the bullet on the run row (not med)
    expect(getByTestId("meditation-log-habit-run").props.accessibilityState.selected).toBe(
      true,
    );
    expect(getByTestId("meditation-log-habit-med").props.accessibilityState.selected).toBe(
      false,
    );
  });

  it("falls back to name match when no last-used", async () => {
    mockUseTodayHabits.items = [
      makeItem("run", "Morning run"),
      makeItem("med", "Breathwork"),
    ];

    const { getByTestId } = render(<MeditationLogSheet />);
    await waitFor(() => {
      expect(getByTestId("meditation-log-habit-med").props.accessibilityState.selected).toBe(
        true,
      );
    });
  });

  it("shows already-completed habits as done and non-tappable", async () => {
    mockUseTodayHabits.items = [
      makeItem("med", "Meditate", true),
      makeItem("run", "Run", false),
    ];

    const { getByTestId, getByLabelText } = render(<MeditationLogSheet />);
    await waitFor(() => {
      expect(getByTestId("meditation-log-done-med")).toBeTruthy();
    });

    expect(getByTestId("meditation-log-habit-med").props.accessibilityState.disabled).toBe(
      true,
    );

    fireEvent.press(getByTestId("meditation-log-habit-med"));
    fireEvent.press(getByLabelText("Log session to habit"));
    // Still pointing at med (name match) which is done — Log should be disabled
    expect(mockToggleCompletion).not.toHaveBeenCalled();
  });

  it("logs full completion via toggleCompletion and remembers habit", async () => {
    mockUseTodayHabits.items = [
      makeItem("med", "Meditate"),
      makeItem("run", "Run"),
    ];

    const onLogged = jest.fn();
    const { getByTestId, getByLabelText } = render(
      <MeditationLogSheet onLogged={onLogged} />,
    );
    await waitFor(() => expect(getByTestId("meditation-log-sheet")).toBeTruthy());

    fireEvent.press(getByTestId("meditation-log-habit-run"));
    fireEvent.press(getByLabelText("Log session to habit"));

    await waitFor(() => {
      expect(mockToggleCompletion).toHaveBeenCalledWith("run", "full");
      expect(onLogged).toHaveBeenCalled();
    });
  });

  it("Not now calls onSkip", async () => {
    mockUseTodayHabits.items = [makeItem("med", "Meditate")];
    const onSkip = jest.fn();
    const { getByLabelText } = render(<MeditationLogSheet onSkip={onSkip} />);
    await waitFor(() => expect(getByLabelText("Not now")).toBeTruthy());
    fireEvent.press(getByLabelText("Not now"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
