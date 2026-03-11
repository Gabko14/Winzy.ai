import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useHabits, useCreateHabit, useUpdateHabit, useArchiveHabit } from "../useHabits";

jest.mock("../../api/habits", () => ({
  fetchHabits: jest.fn(),
  createHabit: jest.fn(),
  updateHabit: jest.fn(),
  archiveHabit: jest.fn(),
}));

const { fetchHabits, createHabit, updateHabit, archiveHabit } = jest.requireMock("../../api/habits");

const mockHabit = {
  id: "h1",
  name: "Morning run",
  icon: "\uD83C\uDFC3",
  color: "#F97316",
  frequency: "daily" as const,
  customDays: null,
  createdAt: "2026-01-01T00:00:00Z",
  archivedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

// --- useHabits ---

describe("useHabits", () => {
  it("fetches habits on mount", async () => {
    fetchHabits.mockResolvedValue([mockHabit]);

    const { result } = renderHook(() => useHabits());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.habits).toEqual([mockHabit]);
    expect(result.current.error).toBeNull();
  });

  it("sets error on fetch failure", async () => {
    const apiError = { status: 500, code: "server_error", message: "Server error" };
    fetchHabits.mockRejectedValue(apiError);

    const { result } = renderHook(() => useHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.habits).toEqual([]);
    expect(result.current.error).toEqual(apiError);
  });

  it("can refresh habits", async () => {
    fetchHabits.mockResolvedValue([mockHabit]);

    const { result } = renderHook(() => useHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const updated = { ...mockHabit, name: "Evening run" };
    fetchHabits.mockResolvedValue([updated]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.habits).toEqual([updated]);
  });

  it("handles empty habits list", async () => {
    fetchHabits.mockResolvedValue([]);

    const { result } = renderHook(() => useHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.habits).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

// --- useCreateHabit ---

describe("useCreateHabit", () => {
  it("creates a habit and calls onSuccess", async () => {
    const onSuccess = jest.fn();
    createHabit.mockResolvedValue(mockHabit);

    const { result } = renderHook(() => useCreateHabit(onSuccess));

    expect(result.current.loading).toBe(false);

    await act(async () => {
      await result.current.create({ name: "Morning run", frequency: "daily" });
    });

    expect(createHabit).toHaveBeenCalledWith({ name: "Morning run", frequency: "daily" });
    expect(onSuccess).toHaveBeenCalledWith(mockHabit);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets error on create failure", async () => {
    const apiError = { status: 400, code: "validation", message: "Name is required" };
    createHabit.mockRejectedValue(apiError);

    const { result } = renderHook(() => useCreateHabit());

    await act(async () => {
      try {
        await result.current.create({ name: "", frequency: "daily" });
      } catch {
        // expected
      }
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.loading).toBe(false);
  });
});

// --- useUpdateHabit ---

describe("useUpdateHabit", () => {
  it("updates a habit and calls onSuccess", async () => {
    const onSuccess = jest.fn();
    const updated = { ...mockHabit, name: "Evening run" };
    updateHabit.mockResolvedValue(updated);

    const { result } = renderHook(() => useUpdateHabit(onSuccess));

    await act(async () => {
      await result.current.update("h1", { name: "Evening run" });
    });

    expect(updateHabit).toHaveBeenCalledWith("h1", { name: "Evening run" });
    expect(onSuccess).toHaveBeenCalledWith(updated);
  });

  it("sets error on update failure", async () => {
    const apiError = { status: 404, code: "not_found", message: "Not found" };
    updateHabit.mockRejectedValue(apiError);

    const { result } = renderHook(() => useUpdateHabit());

    await act(async () => {
      try {
        await result.current.update("h1", { name: "x" });
      } catch {
        // expected
      }
    });

    expect(result.current.error).toEqual(apiError);
  });
});

// --- useArchiveHabit ---

describe("useArchiveHabit", () => {
  it("archives a habit and calls onSuccess", async () => {
    const onSuccess = jest.fn();
    archiveHabit.mockResolvedValue(undefined);

    const { result } = renderHook(() => useArchiveHabit(onSuccess));

    await act(async () => {
      await result.current.archive("h1");
    });

    expect(archiveHabit).toHaveBeenCalledWith("h1");
    expect(onSuccess).toHaveBeenCalled();
  });

  it("sets error on archive failure", async () => {
    const apiError = { status: 0, code: "network", message: "Network error" };
    archiveHabit.mockRejectedValue(apiError);

    const { result } = renderHook(() => useArchiveHabit());

    await act(async () => {
      try {
        await result.current.archive("h1");
      } catch {
        // expected
      }
    });

    expect(result.current.error).toEqual(apiError);
  });
});
