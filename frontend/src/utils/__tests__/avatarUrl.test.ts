import { setBaseUrl } from "../../api/client";
import { resolveAvatarUrl, userAvatarPath } from "../avatarUrl";

describe("avatarUrl helpers", () => {
  beforeEach(() => {
    setBaseUrl("http://localhost:5050");
  });

  it("builds the public serving path", () => {
    expect(userAvatarPath("abc-123")).toBe("/auth/users/abc-123/avatar");
  });

  it("resolves a relative path against the API base URL", () => {
    expect(resolveAvatarUrl("/auth/users/u1/avatar")).toBe(
      "http://localhost:5050/auth/users/u1/avatar",
    );
  });

  it("appends cache-bust query param", () => {
    expect(resolveAvatarUrl("/auth/users/u1/avatar", "2026-07-17T12:00:00Z")).toBe(
      "http://localhost:5050/auth/users/u1/avatar?v=2026-07-17T12%3A00%3A00Z",
    );
  });

  it("returns undefined for null/empty", () => {
    expect(resolveAvatarUrl(null)).toBeUndefined();
    expect(resolveAvatarUrl(undefined)).toBeUndefined();
    expect(resolveAvatarUrl("")).toBeUndefined();
  });

  it("passes through absolute URLs", () => {
    expect(resolveAvatarUrl("https://cdn.example/a.jpg")).toBe("https://cdn.example/a.jpg");
  });
});
