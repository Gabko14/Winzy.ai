import { act, waitFor } from "@testing-library/react-native";
import { useHabits, useCreateHabit, useUpdateHabit, useArchiveHabit, useOrderHabits } from "../useHabits";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";
import { queryKeys } from "../../api/queryKeys";

jest.mock("../../api/habits", () => ({
  fetchHabits: jest.fn(),
  createHabit: jest.fn(),
  updateHabit: jest.fn(),
  archiveHabit: jest.fn(),
  orderHabits: jest.fn(),
}));

const { fetchHabits, createHabit, updateHabit, archiveHabit, orderHabits } =
  jest.requireMock("../../api/habits");

const mockHabit = {
  id: "h1",
  name: "Morning run",
  icon: "\uD83C\uDFC3",
  color: "#F97316",
  frequency: "daily" as const,
  customDays: null,
  minimumDescription: null,
  position: 0,
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

    const { result } = renderHookWithQueryClient(() => useHabits());

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

    const { result } = renderHookWithQueryClient(() => useHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.habits).toEqual([]);
    expect(result.current.error).toEqual(apiError);
  });

  it("can refresh habits", async () => {
    fetchHabits.mockResolvedValue([mockHabit]);

    const { result } = renderHookWithQueryClient(() => useHabits());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const updated = { ...mockHabit, name: "Evening run" };
    fetchHabits.mockResolvedValue([updated]);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.habits).toEqual([updated]);
    });
  });

  it("handles empty habits list", async () => {
    fetchHabits.mockResolvedValue([]);

    const { result } = renderHookWithQueryClient(() => useHabits());

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
    fetchHabits.mockResolvedValue([mockHabit]);

    const { result } = renderHookWithQueryClient(() => useCreateHabit(onSuccess));

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

    const { result } = renderHookWithQueryClient(() => useCreateHabit());

    await act(async () => {
      try {
        await result.current.create({ name: "", frequency: "daily" });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.error).toEqual(apiError);
    });
    expect(result.current.loading).toBe(false);
  });
});

// --- useUpdateHabit ---

describe("useUpdateHabit", () => {
  it("updates a habit and calls onSuccess", async () => {
    const onSuccess = jest.fn();
    const updated = { ...mockHabit, name: "Evening run" };
    updateHabit.mockResolvedValue(updated);
    fetchHabits.mockResolvedValue([updated]);

    const { result } = renderHookWithQueryClient(() => useUpdateHabit(onSuccess));

    await act(async () => {
      await result.current.update("h1", { name: "Evening run" });
    });

    expect(updateHabit).toHaveBeenCalledWith("h1", { name: "Evening run" });
    expect(onSuccess).toHaveBeenCalledWith(updated);
  });

  it("sets error on update failure", async () => {
    const apiError = { status: 404, code: "not_found", message: "Not found" };
    updateHabit.mockRejectedValue(apiError);

    const { result } = renderHookWithQueryClient(() => useUpdateHabit());

    await act(async () => {
      try {
        await result.current.update("h1", { name: "x" });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.error).toEqual(apiError);
    });
  });
});

// --- useArchiveHabit ---

describe("useArchiveHabit", () => {
  it("archives a habit and calls onSuccess", async () => {
    const onSuccess = jest.fn();
    archiveHabit.mockResolvedValue(undefined);
    fetchHabits.mockResolvedValue([]);

    const { result } = renderHookWithQueryClient(() => useArchiveHabit(onSuccess));

    await act(async () => {
      await result.current.archive("h1");
    });

    expect(archiveHabit).toHaveBeenCalledWith("h1");
    expect(onSuccess).toHaveBeenCalled();
  });

  it("sets error on archive failure", async () => {
    const apiError = { status: 0, code: "network", message: "Network error" };
    archiveHabit.mockRejectedValue(apiError);

    const { result } = renderHookWithQueryClient(() => useArchiveHabit());

    await act(async () => {
      try {
        await result.current.archive("h1");
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.error).toEqual(apiError);
    });
  });
});

// --- useOrderHabits ---

describe("useOrderHabits", () => {
  const h1 = { ...mockHabit, id: "h1", name: "A", position: 0 };
  const h2 = { ...mockHabit, id: "h2", name: "B", position: 1 };

  it("optimistically reorders then persists via orderHabits", async () => {
    orderHabits.mockResolvedValue(undefined);
    fetchHabits.mockResolvedValue([h1, h2]);

    const { result, queryClient } = renderHookWithQueryClient(() => useOrderHabits());
    queryClient.setQueryData(queryKeys.habits.list(), [h1, h2]);

    await act(async () => {
      await result.current.order(["h2", "h1"]);
    });

    expect(orderHabits).toHaveBeenCalledWith({ habitIds: ["h2", "h1"] });
  });

  it("reverts cache when orderHabits fails", async () => {
    orderHabits.mockRejectedValue({
      status: 400,
      code: "validation_error",
      message: "bad set",
    });
    fetchHabits.mockResolvedValue([h1, h2]);

    const { result, queryClient } = renderHookWithQueryClient(() => useOrderHabits());
    queryClient.setQueryData(queryKeys.habits.list(), [h1, h2]);

    await act(async () => {
      try {
        await result.current.order(["h2", "h1"]);
      } catch {
        // expected
      }
    });

    expect(queryClient.getQueryData(queryKeys.habits.list())).toEqual([h1, h2]);
  });
});
