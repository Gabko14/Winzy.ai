import {
  validateEmail,
  validateUsername,
  validatePassword,
  validateLoginIdentifier,
} from "../validation";

describe("validateEmail", () => {
  it("accepts valid emails", () => {
    expect(validateEmail("user@example.com")).toBeNull();
    expect(validateEmail("a@b.co")).toBeNull();
    expect(validateEmail(" user@example.com ")).toBeNull(); // trimmed
  });

  it("rejects empty input", () => {
    expect(validateEmail("")).toBe("Email is required.");
    expect(validateEmail("   ")).toBe("Email is required.");
  });

  it("rejects invalid format", () => {
    expect(validateEmail("notanemail")).toBe("Please enter a valid email address.");
    expect(validateEmail("missing@domain")).toBe("Please enter a valid email address.");
    expect(validateEmail("@no-local.com")).toBe("Please enter a valid email address.");
  });

  it("rejects emails exceeding 256 characters", () => {
    const long = "a".repeat(251) + "@b.com"; // 257 chars total
    expect(validateEmail(long)).toBe("Email must not exceed 256 characters.");
  });
});

describe("validateUsername", () => {
  it("accepts valid usernames", () => {
    expect(validateUsername("alice")).toBeNull();
    expect(validateUsername("user_name")).toBeNull();
    expect(validateUsername("user-name")).toBeNull();
    expect(validateUsername("abc")).toBeNull(); // minimum 3
    expect(validateUsername("A1_-b")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(validateUsername("")).toBe("Username is required.");
    expect(validateUsername("   ")).toBe("Username is required.");
  });

  it("rejects too-short usernames", () => {
    expect(validateUsername("ab")).toBe("Username must be at least 3 characters.");
  });

  it("rejects too-long usernames", () => {
    expect(validateUsername("a".repeat(65))).toBe("Username must not exceed 64 characters.");
  });

  it("rejects invalid characters", () => {
    expect(validateUsername("user name")).toBe(
      "Username can only contain letters, digits, hyphens, and underscores.",
    );
    expect(validateUsername("user@name")).toBe(
      "Username can only contain letters, digits, hyphens, and underscores.",
    );
    expect(validateUsername("user.name")).toBe(
      "Username can only contain letters, digits, hyphens, and underscores.",
    );
  });
});

describe("validatePassword", () => {
  it("accepts valid passwords", () => {
    expect(validatePassword("12345678")).toBeNull();
    expect(validatePassword("a".repeat(128))).toBeNull(); // max allowed
  });

  it("rejects empty input", () => {
    expect(validatePassword("")).toBe("Password is required.");
  });

  it("rejects too-short passwords", () => {
    expect(validatePassword("1234567")).toBe("Password must be at least 8 characters.");
  });

  it("rejects too-long passwords", () => {
    expect(validatePassword("a".repeat(129))).toBe("Password must not exceed 128 characters.");
  });
});

describe("validateLoginIdentifier", () => {
  it("accepts non-empty input", () => {
    expect(validateLoginIdentifier("user@example.com")).toBeNull();
    expect(validateLoginIdentifier("username")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(validateLoginIdentifier("")).toBe("Email or username is required.");
    expect(validateLoginIdentifier("   ")).toBe("Email or username is required.");
  });
});
