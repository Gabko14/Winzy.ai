import {
  nextCompletionCycle,
  isDateInCompletionWindow,
  addDaysISO,
  weekStripRange,
  isHabitDueOnDate,
  weekdayInitial,
} from "../completionCycle";

describe("nextCompletionCycle", () => {
  it("none → full", () => {
    expect(nextCompletionCycle(null, false)).toEqual({ action: "complete", kind: "full" });
    expect(nextCompletionCycle(undefined, true)).toEqual({ action: "complete", kind: "full" });
  });

  it("full → none when habit has no minimum", () => {
    expect(nextCompletionCycle("full", false)).toEqual({ action: "uncomplete" });
  });

  it("full → minimum when habit has minimum", () => {
    expect(nextCompletionCycle("full", true)).toEqual({ action: "updateKind", kind: "minimum" });
  });

  it("minimum → none", () => {
    expect(nextCompletionCycle("minimum", true)).toEqual({ action: "uncomplete" });
  });

  it("minimum without hasMinimum still uncompletes", () => {
    expect(nextCompletionCycle("minimum", false)).toEqual({ action: "uncomplete" });
  });
});

describe("isDateInCompletionWindow", () => {
  const today = "2026-03-09";

  it("allows today and days within 60-day window", () => {
    expect(isDateInCompletionWindow(today, today)).toBe(true);
    expect(isDateInCompletionWindow(addDaysISO(today, -6), today)).toBe(true);
    expect(isDateInCompletionWindow(addDaysISO(today, -59), today)).toBe(true);
  });

  it("rejects future dates and dates before window start", () => {
    expect(isDateInCompletionWindow(addDaysISO(today, 1), today)).toBe(false);
    expect(isDateInCompletionWindow(addDaysISO(today, -60), today)).toBe(false);
  });
});

describe("weekStripRange", () => {
  it("returns inclusive today-6 .. today", () => {
    expect(weekStripRange("2026-03-09")).toEqual({
      from: "2026-03-03",
      to: "2026-03-09",
    });
  });
});

describe("isHabitDueOnDate", () => {
  it("daily is always due", () => {
    expect(isHabitDueOnDate("daily", null, "2026-03-09")).toBe(true);
  });

  it("weekly/custom due only on customDays", () => {
    // 2026-03-09 is Monday (1)
    expect(isHabitDueOnDate("weekly", [1, 3, 5], "2026-03-09")).toBe(true);
    expect(isHabitDueOnDate("weekly", [1, 3, 5], "2026-03-10")).toBe(false);
    expect(isHabitDueOnDate("custom", [], "2026-03-09")).toBe(false);
    expect(isHabitDueOnDate("custom", null, "2026-03-09")).toBe(false);
  });
});

describe("weekdayInitial", () => {
  it("returns single-letter weekday", () => {
    expect(weekdayInitial("2026-03-08")).toBe("S"); // Sunday
    expect(weekdayInitial("2026-03-09")).toBe("M");
  });
});
