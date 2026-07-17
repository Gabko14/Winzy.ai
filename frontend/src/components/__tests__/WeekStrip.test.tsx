import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { WeekStrip } from "../WeekStrip";
import type { Habit, CompletionDayEntry } from "../../api/habits";

const today = "2026-03-09";

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "h1",
    name: "Run",
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

function weekDays(completed: Record<string, "full" | "minimum" | null> = {}): CompletionDayEntry[] {
  const dates = [
    "2026-03-03",
    "2026-03-04",
    "2026-03-05",
    "2026-03-06",
    "2026-03-07",
    "2026-03-08",
    "2026-03-09",
  ];
  return dates.map((date) => {
    const kind = completed[date] ?? null;
    return { date, completed: kind != null, completionKind: kind };
  });
}

describe("WeekStrip", () => {
  it("renders seven cells for the week", () => {
    const { getByTestId } = render(
      <WeekStrip
        habit={makeHabit()}
        weekDays={weekDays()}
        today={today}
        completing={new Set()}
        onToggleDay={jest.fn()}
      />,
    );
    expect(getByTestId("week-strip-h1")).toBeTruthy();
    for (const d of weekDays()) {
      expect(getByTestId(`week-cell-h1-${d.date}`)).toBeTruthy();
    }
  });

  it("calls onToggleDay for a past day", () => {
    const onToggleDay = jest.fn();
    const { getByTestId } = render(
      <WeekStrip
        habit={makeHabit()}
        weekDays={weekDays()}
        today={today}
        completing={new Set()}
        onToggleDay={onToggleDay}
      />,
    );
    fireEvent.press(getByTestId("week-cell-h1-2026-03-08"));
    expect(onToggleDay).toHaveBeenCalledWith("h1", "2026-03-08");
  });

  it("mutes not-due days for weekly habits", () => {
    // Monday-only weekly; 2026-03-08 is Sunday
    const { getByTestId } = render(
      <WeekStrip
        habit={makeHabit({ frequency: "weekly", customDays: [1] })}
        weekDays={weekDays()}
        today={today}
        completing={new Set()}
        onToggleDay={jest.fn()}
      />,
    );
    const sunday = getByTestId("week-cell-h1-2026-03-08");
    expect(sunday.props.accessibilityLabel).toMatch(/not due/);
    const monday = getByTestId("week-cell-h1-2026-03-09");
    expect(monday.props.accessibilityLabel).not.toMatch(/not due/);
  });

  it("marks completed cells in accessibility state", () => {
    const { getByTestId } = render(
      <WeekStrip
        habit={makeHabit()}
        weekDays={weekDays({ "2026-03-08": "full" })}
        today={today}
        completing={new Set()}
        onToggleDay={jest.fn()}
      />,
    );
    expect(getByTestId("week-cell-h1-2026-03-08").props.accessibilityState).toMatchObject({
      checked: true,
    });
  });
});
