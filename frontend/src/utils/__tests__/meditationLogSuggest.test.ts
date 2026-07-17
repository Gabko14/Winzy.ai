import {
  suggestHabitId,
  MEDITATION_NAME_HINT,
} from "../meditationLogSuggest";

describe("suggestHabitId", () => {
  const habits = [
    { id: "h1", name: "Morning run" },
    { id: "h2", name: "Meditate" },
    { id: "h3", name: "Read" },
  ];

  it("prefers last-used when still in the list", () => {
    expect(suggestHabitId(habits, "h3")).toBe("h3");
  });

  it("last-used beats name-match", () => {
    expect(suggestHabitId(habits, "h1")).toBe("h1");
  });

  it("falls back to name match when last-used missing", () => {
    expect(suggestHabitId(habits, "gone")).toBe("h2");
    expect(suggestHabitId(habits, null)).toBe("h2");
  });

  it("returns null when no last-used and no name match", () => {
    expect(
      suggestHabitId(
        [
          { id: "a", name: "Run" },
          { id: "b", name: "Read" },
        ],
        null,
      ),
    ).toBeNull();
  });

  it("returns null for empty list", () => {
    expect(suggestHabitId([], "h1")).toBeNull();
  });

  it("name hint matches breath/mindful/calm/zen", () => {
    expect(MEDITATION_NAME_HINT.test("Breathwork")).toBe(true);
    expect(MEDITATION_NAME_HINT.test("Mindful walk")).toBe(true);
    expect(MEDITATION_NAME_HINT.test("Stay calm")).toBe(true);
    expect(MEDITATION_NAME_HINT.test("Zen garden")).toBe(true);
    expect(suggestHabitId([{ id: "z", name: "Evening Zen" }], null)).toBe("z");
  });
});
