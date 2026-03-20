import { flameLevelFromConsistency, flameBackgroundColor, flameTextColor } from "../flameHelpers";

describe("flameLevelFromConsistency", () => {
  // --- Happy path ---

  it("returns blazing for consistency >= 80", () => {
    expect(flameLevelFromConsistency(80)).toBe("blazing");
    expect(flameLevelFromConsistency(100)).toBe("blazing");
  });

  it("returns strong for consistency >= 55 and < 80", () => {
    expect(flameLevelFromConsistency(55)).toBe("strong");
    expect(flameLevelFromConsistency(79)).toBe("strong");
  });

  it("returns steady for consistency >= 30 and < 55", () => {
    expect(flameLevelFromConsistency(30)).toBe("steady");
    expect(flameLevelFromConsistency(54)).toBe("steady");
  });

  it("returns ember for consistency >= 10 and < 30", () => {
    expect(flameLevelFromConsistency(10)).toBe("ember");
    expect(flameLevelFromConsistency(29)).toBe("ember");
  });

  it("returns none for consistency < 10", () => {
    expect(flameLevelFromConsistency(0)).toBe("none");
    expect(flameLevelFromConsistency(9)).toBe("none");
  });

  // --- Edge cases ---

  it("handles exact boundary values", () => {
    expect(flameLevelFromConsistency(10)).toBe("ember");
    expect(flameLevelFromConsistency(30)).toBe("steady");
    expect(flameLevelFromConsistency(55)).toBe("strong");
    expect(flameLevelFromConsistency(80)).toBe("blazing");
  });

  it("handles negative values", () => {
    expect(flameLevelFromConsistency(-1)).toBe("none");
  });
});

describe("flameBackgroundColor", () => {
  it("returns correct color for each flame level", () => {
    expect(flameBackgroundColor("blazing")).toBe("#FEE2E2");
    expect(flameBackgroundColor("strong")).toBe("#FFEDD5");
    expect(flameBackgroundColor("steady")).toBe("#FFF7ED");
    expect(flameBackgroundColor("ember")).toBe("#FEF3C7");
    expect(flameBackgroundColor("none")).toBe("#F5F5F4");
  });
});

describe("flameTextColor", () => {
  it("returns correct color for each flame level", () => {
    expect(flameTextColor("blazing")).toBe("#DC2626");
    expect(flameTextColor("strong")).toBe("#F97316");
    expect(flameTextColor("steady")).toBe("#EA580C");
    expect(flameTextColor("ember")).toBe("#D97706");
    expect(flameTextColor("none")).toBe("#78716C");
  });
});
