import { patchRangeDay, findHabitInRange, dayEntryFor } from "../completionsRangeCache";
import type { CompletionsRangeResponse } from "../../api/habits";

function makeRange(): CompletionsRangeResponse {
  return {
    from: "2026-03-03",
    to: "2026-03-09",
    habits: [
      {
        id: "h1",
        name: "Run",
        icon: null,
        color: null,
        frequency: "daily",
        customDays: null,
        minimumDescription: null,
        days: [
          { date: "2026-03-08", completed: false, completionKind: null },
          { date: "2026-03-09", completed: false, completionKind: null },
        ],
      },
    ],
  };
}

describe("completionsRangeCache", () => {
  it("findHabitInRange and dayEntryFor locate entries", () => {
    const data = makeRange();
    expect(findHabitInRange(data, "h1")?.id).toBe("h1");
    expect(findHabitInRange(data, "missing")).toBeUndefined();
    expect(dayEntryFor(findHabitInRange(data, "h1"), "2026-03-09")?.completed).toBe(false);
  });

  it("patchRangeDay updates one day without mutating other habits/days", () => {
    const data = makeRange();
    const next = patchRangeDay(data, "h1", "2026-03-08", true, "full");
    expect(dayEntryFor(findHabitInRange(next, "h1"), "2026-03-08")).toEqual({
      date: "2026-03-08",
      completed: true,
      completionKind: "full",
    });
    expect(dayEntryFor(findHabitInRange(next, "h1"), "2026-03-09")?.completed).toBe(false);
    // Original unchanged
    expect(dayEntryFor(findHabitInRange(data, "h1"), "2026-03-08")?.completed).toBe(false);
  });

  it("patchRangeDay can clear a day (undo revert)", () => {
    const data = patchRangeDay(makeRange(), "h1", "2026-03-08", true, "full");
    const reverted = patchRangeDay(data, "h1", "2026-03-08", false, null);
    expect(dayEntryFor(findHabitInRange(reverted, "h1"), "2026-03-08")).toEqual({
      date: "2026-03-08",
      completed: false,
      completionKind: null,
    });
  });
});
