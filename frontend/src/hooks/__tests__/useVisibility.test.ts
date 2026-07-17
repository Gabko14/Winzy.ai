import { act, waitFor } from "@testing-library/react-native";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";
import { useVisibility, useDefaultVisibility, useUpdateVisibility } from "../useVisibility";

jest.mock("../../api/visibility", () => ({
  fetchVisibility: jest.fn(),
  fetchPreferences: jest.fn(),
  updateVisibility: jest.fn(),
}));

const { fetchVisibility, fetchPreferences, updateVisibility } =
  jest.requireMock("../../api/visibility");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useVisibility — auth gate (winzy.ai-2pb1)", () => {
  it("does not fetch when isAuthenticated is false", async () => {
    const { result } = renderHookWithQueryClient(() => useVisibility(false));

    expect(result.current.loading).toBe(false);
    expect(result.current.visibilityMap).toEqual({});
    expect(result.current.defaultVisibility).toBe("private");
    expect(fetchVisibility).not.toHaveBeenCalled();
  });

  it("resets to inert defaults when isAuthenticated transitions to false", async () => {
    fetchVisibility.mockResolvedValue({
      defaultVisibility: "friends",
      habits: [{ habitId: "h1", visibility: "public" }],
    });

    const { result, rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => useVisibility(authed),
      { initialProps: { authed: true } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.visibilityMap).toEqual({ h1: "public" });

    rerender({ authed: false });

    expect(result.current.visibilityMap).toEqual({});
    expect(result.current.defaultVisibility).toBe("private");
    expect(result.current.loading).toBe(false);
  });

  it("fetches when isAuthenticated transitions to true", async () => {
    fetchVisibility.mockResolvedValue({
      defaultVisibility: "private",
      habits: [{ habitId: "h1", visibility: "friends" }],
    });

    const { result, rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => useVisibility(authed),
      { initialProps: { authed: false } },
    );

    expect(fetchVisibility).not.toHaveBeenCalled();

    rerender({ authed: true });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchVisibility).toHaveBeenCalled();
    expect(result.current.getVisibility("h1")).toBe("friends");
  });
});

describe("useVisibility", () => {
  it("fetches batch visibility and builds a map", async () => {
    fetchVisibility.mockResolvedValue({
      defaultVisibility: "private",
      habits: [
        { habitId: "h1", visibility: "public" },
        { habitId: "h2", visibility: "friends" },
      ],
    });

    const { result } = renderHookWithQueryClient(() => useVisibility());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.visibilityMap).toEqual({
      h1: "public",
      h2: "friends",
    });
    expect(result.current.defaultVisibility).toBe("private");
    expect(result.current.error).toBeNull();
  });

  it("returns default visibility for unknown habits", async () => {
    fetchVisibility.mockResolvedValue({
      defaultVisibility: "friends",
      habits: [{ habitId: "h1", visibility: "public" }],
    });

    const { result } = renderHookWithQueryClient(() => useVisibility());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.getVisibility("h1")).toBe("public");
    expect(result.current.getVisibility("unknown")).toBe("friends");
  });

  it("handles fetch error gracefully", async () => {
    const apiError = { status: 500, code: "server_error", message: "boom" };
    fetchVisibility.mockRejectedValue(apiError);

    const { result } = renderHookWithQueryClient(() => useVisibility());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
  });
});

describe("useDefaultVisibility", () => {
  it("fetches user default from preferences", async () => {
    fetchPreferences.mockResolvedValue({ defaultHabitVisibility: "friends" });

    const { result } = renderHookWithQueryClient(() => useDefaultVisibility());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.defaultVisibility).toBe("friends");
    expect(result.current.error).toBeNull();
  });

  it("falls back to private when Social Service is down", async () => {
    const apiError = { status: 0, code: "network", message: "down" };
    fetchPreferences.mockRejectedValue(apiError);

    const { result } = renderHookWithQueryClient(() => useDefaultVisibility());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.defaultVisibility).toBe("private");
    expect(result.current.error).toEqual(apiError);
  });
});

describe("useUpdateVisibility", () => {
  it("calls API and triggers onSuccess", async () => {
    const onSuccess = jest.fn();
    updateVisibility.mockResolvedValue({ habitId: "h1", visibility: "public" });
    fetchVisibility.mockResolvedValue({ defaultVisibility: "private", habits: [] });

    const { result } = renderHookWithQueryClient(() => useUpdateVisibility(onSuccess));

    await act(async () => {
      await result.current.update("h1", "public");
    });

    expect(updateVisibility).toHaveBeenCalledWith("h1", "public");
    expect(onSuccess).toHaveBeenCalled();
  });

  it("throws and sets error on failure", async () => {
    const apiError = { status: 400, code: "validation", message: "bad" };
    updateVisibility.mockRejectedValue(apiError);

    const { result } = renderHookWithQueryClient(() => useUpdateVisibility());

    await act(async () => {
      try {
        await result.current.update("h1", "public");
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.error).toEqual(apiError);
    });
  });
});
