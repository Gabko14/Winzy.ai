import { getInitials } from "../getInitials";

describe("getInitials", () => {
  // --- Happy path ---

  it("returns first and last initials for a two-word display name", () => {
    expect(getInitials("John Smith")).toBe("JS");
  });

  it("returns first and last initials for a three-word display name", () => {
    expect(getInitials("Mary Jane Watson")).toBe("MW");
  });

  it("returns first two chars for a single-word display name", () => {
    expect(getInitials("Alice")).toBe("AL");
  });

  it("falls back to username when displayName is null", () => {
    expect(getInitials(null, "jsmith")).toBe("JS");
  });

  it("falls back to fallbackId when both name and username are null", () => {
    expect(getInitials(null, null, "abc123")).toBe("AB");
  });

  it("returns ?? when all inputs are null/undefined", () => {
    expect(getInitials()).toBe("??");
    expect(getInitials(null, null, null)).toBe("??");
    expect(getInitials(undefined, undefined, undefined)).toBe("??");
  });

  // --- Edge cases ---

  it("handles extra whitespace in display name", () => {
    expect(getInitials("  John   Smith  ")).toBe("JS");
  });

  it("handles single character display name", () => {
    expect(getInitials("A")).toBe("A");
  });

  it("handles single character username", () => {
    expect(getInitials(null, "x")).toBe("X");
  });

  it("uppercases lowercase initials", () => {
    expect(getInitials("jane doe")).toBe("JD");
  });

  it("prefers displayName over username", () => {
    expect(getInitials("John Doe", "jdoe")).toBe("JD");
  });

  it("prefers username over fallbackId", () => {
    expect(getInitials(null, "jdoe", "user-123")).toBe("JD");
  });

  // --- Error conditions ---

  it("handles empty string displayName, falls back to username", () => {
    expect(getInitials("", "jsmith")).toBe("JS");
  });

  it("handles whitespace-only displayName, falls back to username", () => {
    expect(getInitials("   ", "jsmith")).toBe("JS");
  });

  it("handles empty string username, falls back to fallbackId", () => {
    expect(getInitials(null, "", "abc123")).toBe("AB");
  });
});
