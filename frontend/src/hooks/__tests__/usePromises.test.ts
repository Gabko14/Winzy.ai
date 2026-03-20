import { renderHook, act, waitFor } from "@testing-library/react-native";
import { usePromises } from "../usePromises";

const mockFetchPromise = jest.fn();
const mockCreatePromise = jest.fn();
const mockCancelPromise = jest.fn();

jest.mock("../../api/promises", () => ({
  fetchPromise: (...args: unknown[]) => mockFetchPromise(...args),
  createPromise: (...args: unknown[]) => mockCreatePromise(...args),
  cancelPromise: (...args: unknown[]) => mockCancelPromise(...args),
}));

const mockActivePromise = {
  id: "promise-1",
  habitId: "habit-1",
  targetConsistency: 70,
  endDate: "2026-04-30",
  privateNote: null,
  status: "active" as const,
  onTrack: true,
  currentConsistency: 75,
  statement: "Keeping above 70% through April 30",
  createdAt: "2026-03-15T00:00:00Z",
  resolvedAt: null,
};

const mockKeptPromise = {
  ...mockActivePromise,
  id: "promise-0",
  status: "kept" as const,
  onTrack: null,
  currentConsistency: null,
  resolvedAt: "2026-03-14T00:00:00Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchPromise.mockResolvedValue({
    active: mockActivePromise,
    history: [mockKeptPromise],
  });
  mockCreatePromise.mockResolvedValue(mockActivePromise);
  mockCancelPromise.mockResolvedValue(undefined);
});

describe("usePromises", () => {
  it("loads promise data on mount", async () => {
    const { result } = renderHook(() => usePromises("habit-1", "UTC"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data?.active).toEqual(mockActivePromise);
    expect(result.current.data?.history).toHaveLength(1);
    expect(mockFetchPromise).toHaveBeenCalledWith("habit-1", "UTC", true);
  });

  it("handles fetch error gracefully", async () => {
    mockFetchPromise.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Server error",
    });

    const { result } = renderHook(() => usePromises("habit-1", "UTC"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.data).toBeNull();
  });

  it("creates a promise and refreshes", async () => {
    const { result } = renderHook(() => usePromises("habit-1", "UTC"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.create({
        targetConsistency: 80,
        endDate: "2026-05-01",
      });
    });

    expect(mockCreatePromise).toHaveBeenCalledWith("habit-1", {
      targetConsistency: 80,
      endDate: "2026-05-01",
    });
    // Refresh is called after create
    expect(mockFetchPromise).toHaveBeenCalledTimes(2);
  });

  it("cancels a promise and refreshes", async () => {
    const { result } = renderHook(() => usePromises("habit-1", "UTC"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.cancel();
    });

    expect(mockCancelPromise).toHaveBeenCalledWith("habit-1");
    // Refresh is called after cancel
    expect(mockFetchPromise).toHaveBeenCalledTimes(2);
  });

  it("returns null data when no promise exists", async () => {
    mockFetchPromise.mockResolvedValue({
      active: null,
      history: [],
    });

    const { result } = renderHook(() => usePromises("habit-1", "UTC"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data?.active).toBeNull();
    expect(result.current.data?.history).toEqual([]);
  });

  it("re-fetches when habitId changes", async () => {
    const { result, rerender } = renderHook(
      ({ habitId }: { habitId: string }) => usePromises(habitId, "UTC"),
      { initialProps: { habitId: "habit-1" } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender({ habitId: "habit-2" });

    await waitFor(() => {
      expect(mockFetchPromise).toHaveBeenCalledWith("habit-2", "UTC", true);
    });
  });
});
