import { renderHook, waitFor, act } from "@testing-library/react-native";
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

describe("useVisibility", () => {
  it("fetches batch visibility and builds a map", async () => {
    fetchVisibility.mockResolvedValue({
      defaultVisibility: "private",
      habits: [
        { habitId: "h1", visibility: "friends" },
        { habitId: "h2", visibility: "public" },
      ],
    });

    const { result } = renderHook(() => useVisibility());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.getVisibility("h1")).toBe("friends");
    expect(result.current.getVisibility("h2")).toBe("public");
    // Unknown habit falls back to default
    expect(result.current.getVisibility("h3")).toBe("private");
  });

  it("returns default visibility for unknown habits", async () => {
    fetchVisibility.mockResolvedValue({
      defaultVisibility: "friends",
      habits: [],
    });

    const { result } = renderHook(() => useVisibility());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.getVisibility("any-id")).toBe("friends");
  });

  it("handles fetch error gracefully", async () => {
    fetchVisibility.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Server error",
    });

    const { result } = renderHook(() => useVisibility());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    // Falls back to private for everything
    expect(result.current.getVisibility("h1")).toBe("private");
  });
});

describe("useDefaultVisibility", () => {
  it("fetches user default from preferences", async () => {
    fetchPreferences.mockResolvedValue({
      defaultHabitVisibility: "friends",
    });

    const { result } = renderHook(() => useDefaultVisibility());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.defaultVisibility).toBe("friends");
    expect(result.current.error).toBeNull();
  });

  it("falls back to private when Social Service is down", async () => {
    fetchPreferences.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Network error",
    });

    const { result } = renderHook(() => useDefaultVisibility());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.defaultVisibility).toBe("private");
    expect(result.current.error).toBeTruthy();
  });
});

describe("useUpdateVisibility", () => {
  it("calls API and triggers onSuccess", async () => {
    updateVisibility.mockResolvedValue({ habitId: "h1", visibility: "public" });
    const onSuccess = jest.fn();

    const { result } = renderHook(() => useUpdateVisibility(onSuccess));

    await act(async () => {
      await result.current.update("h1", "public");
    });

    expect(updateVisibility).toHaveBeenCalledWith("h1", "public");
    expect(onSuccess).toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("throws and sets error on failure", async () => {
    const apiError = { status: 404, code: "not_found", message: "Not found" };
    updateVisibility.mockRejectedValue(apiError);

    const { result } = renderHook(() => useUpdateVisibility());

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.update("h1", "public");
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toEqual(apiError);

    await waitFor(() => {
      expect(result.current.error).toEqual(apiError);
    });
  });
});
