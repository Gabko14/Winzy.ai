import { renderHook, act, waitFor } from "@testing-library/react-native";
import {
  useChallenges,
  useChallengeDetail,
  useHabitChallenges,
} from "../useChallenges";

jest.mock("../../api/challenges", () => ({
  fetchChallenges: jest.fn(),
  fetchChallengeDetail: jest.fn(),
}));

const { fetchChallenges, fetchChallengeDetail } =
  jest.requireMock("../../api/challenges");

const makeChallenge = (
  id: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  habitId: "habit-1",
  creatorId: "creator-1",
  recipientId: "recipient-1",
  milestoneType: "consistencyTarget" as const,
  targetValue: 80,
  periodDays: 30,
  rewardDescription: "Coffee date",
  status: "active" as const,
  createdAt: "2026-03-01T00:00:00Z",
  endsAt: "2026-04-01T00:00:00Z",
  completedAt: null,
  claimedAt: null,
  ...overrides,
});

const makeChallengeDetail = (
  id: string,
  overrides: Record<string, unknown> = {},
) => ({
  ...makeChallenge(id, overrides),
  progress: 0.5,
  completionCount: 15,
  baselineConsistency: null,
  customStartDate: null,
  customEndDate: null,
  creatorDisplayName: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// useChallenges
// =============================================================================

describe("useChallenges", () => {
  // --- Happy path ---

  it("loads challenges on mount", async () => {
    const items = [makeChallengeDetail("c1"), makeChallengeDetail("c2")];
    fetchChallenges.mockResolvedValue({
      items,
      page: 1,
      pageSize: 100,
      total: 2,
    });

    const { result } = renderHook(() => useChallenges());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenges).toEqual(items);
    expect(result.current.error).toBeNull();
    expect(fetchChallenges).toHaveBeenCalledWith(1, 100);
  });

  it("refresh reloads challenge list", async () => {
    fetchChallenges
      .mockResolvedValueOnce({
        items: [makeChallengeDetail("c1")],
        page: 1,
        pageSize: 100,
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [makeChallengeDetail("c1"), makeChallengeDetail("c2")],
        page: 1,
        pageSize: 100,
        total: 2,
      });

    const { result } = renderHook(() => useChallenges());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenges).toHaveLength(1);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenges).toHaveLength(2);
  });

  // --- Edge cases ---

  it("handles empty challenge list", async () => {
    fetchChallenges.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { result } = renderHook(() => useChallenges());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenges).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // --- Error conditions ---

  it("sets error on fetch failure", async () => {
    const apiError = {
      status: 500,
      code: "server_error",
      message: "Internal error",
    };
    fetchChallenges.mockRejectedValue(apiError);

    const { result } = renderHook(() => useChallenges());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.challenges).toEqual([]);
  });

  it("preserves existing challenges on refresh error", async () => {
    const items = [makeChallengeDetail("c1")];
    fetchChallenges
      .mockResolvedValueOnce({
        items,
        page: 1,
        pageSize: 100,
        total: 1,
      })
      .mockRejectedValueOnce({
        status: 500,
        code: "server_error",
        message: "Oops",
      });

    const { result } = renderHook(() => useChallenges());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenges).toHaveLength(1);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.challenges).toEqual(items);
  });

  it("clears error on successful refresh after failure", async () => {
    const apiError = {
      status: 0,
      code: "network",
      message: "Network error",
    };
    fetchChallenges
      .mockRejectedValueOnce(apiError)
      .mockResolvedValueOnce({
        items: [makeChallengeDetail("c1")],
        page: 1,
        pageSize: 100,
        total: 1,
      });

    const { result } = renderHook(() => useChallenges());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.challenges).toHaveLength(1);
  });
});

// =============================================================================
// useChallengeDetail
// =============================================================================

describe("useChallengeDetail", () => {
  // --- Happy path ---

  it("fetches challenge detail by id on mount", async () => {
    const detail = makeChallengeDetail("c1", { progress: 0.75 });
    fetchChallengeDetail.mockResolvedValue(detail);

    const { result } = renderHook(() => useChallengeDetail("c1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.challenge).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenge).toEqual(detail);
    expect(result.current.error).toBeNull();
    expect(fetchChallengeDetail).toHaveBeenCalledWith("c1");
  });

  it("refresh reloads the detail", async () => {
    fetchChallengeDetail
      .mockResolvedValueOnce(makeChallengeDetail("c1", { progress: 0.5 }))
      .mockResolvedValueOnce(makeChallengeDetail("c1", { progress: 0.8 }));

    const { result } = renderHook(() => useChallengeDetail("c1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenge?.progress).toBe(0.5);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenge?.progress).toBe(0.8);
  });

  it("refetches when id changes", async () => {
    fetchChallengeDetail
      .mockResolvedValueOnce(makeChallengeDetail("c1"))
      .mockResolvedValueOnce(makeChallengeDetail("c2"));

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useChallengeDetail(id),
      { initialProps: { id: "c1" } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenge?.id).toBe("c1");

    rerender({ id: "c2" });

    await waitFor(() => {
      expect(result.current.challenge?.id).toBe("c2");
    });

    expect(fetchChallengeDetail).toHaveBeenCalledWith("c2");
  });

  // --- Error conditions ---

  it("sets error on fetch failure", async () => {
    const apiError = {
      status: 404,
      code: "not_found",
      message: "Challenge not found",
    };
    fetchChallengeDetail.mockRejectedValue(apiError);

    const { result } = renderHook(() => useChallengeDetail("missing"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.challenge).toBeNull();
  });

  it("preserves existing challenge on refresh error", async () => {
    const detail = makeChallengeDetail("c1", { progress: 0.6 });
    fetchChallengeDetail
      .mockResolvedValueOnce(detail)
      .mockRejectedValueOnce({
        status: 500,
        code: "server_error",
        message: "Failed",
      });

    const { result } = renderHook(() => useChallengeDetail("c1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenge).toEqual(detail);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.challenge).toEqual(detail);
  });
});

// =============================================================================
// useHabitChallenges
// =============================================================================

describe("useHabitChallenges", () => {
  // --- Happy path ---

  it("filters challenges for a specific habit from the list", async () => {
    const c1 = makeChallengeDetail("c1", {
      habitId: "habit-1",
      status: "active",
    });
    const c2 = makeChallengeDetail("c2", {
      habitId: "habit-2",
      status: "active",
    });
    const c3 = makeChallengeDetail("c3", {
      habitId: "habit-1",
      status: "completed",
    });

    fetchChallenges.mockResolvedValue({
      items: [c1, c2, c3],
      page: 1,
      pageSize: 100,
      total: 3,
    });

    const { result } = renderHook(() => useHabitChallenges("habit-1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Only c1 matches (habit-1 + active) — c2 is different habit, c3 is completed
    expect(result.current.challenges).toHaveLength(1);
    expect(result.current.challenges[0].id).toBe("c1");
    expect(result.current.error).toBeNull();
  });

  it("returns multiple active challenges for the same habit", async () => {
    const c1 = makeChallengeDetail("c1", {
      habitId: "habit-1",
      status: "active",
      progress: 0.3,
    });
    const c2 = makeChallengeDetail("c2", {
      habitId: "habit-1",
      status: "active",
      progress: 0.7,
    });

    fetchChallenges.mockResolvedValue({
      items: [c1, c2],
      page: 1,
      pageSize: 100,
      total: 2,
    });

    const { result } = renderHook(() => useHabitChallenges("habit-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenges).toHaveLength(2);
    expect(result.current.challenges[0].id).toBe("c1");
    expect(result.current.challenges[1].id).toBe("c2");
  });

  it("refresh reloads habit challenges", async () => {
    fetchChallenges.mockResolvedValue({
      items: [
        makeChallengeDetail("c1", { habitId: "habit-1", status: "active" }),
      ],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    const { result } = renderHook(() => useHabitChallenges("habit-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    fetchChallenges.mockClear();

    fetchChallenges.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchChallenges).toHaveBeenCalledTimes(1);
    expect(result.current.challenges).toEqual([]);
  });

  // --- Edge cases ---

  it("returns empty when no challenges match the habit", async () => {
    fetchChallenges.mockResolvedValue({
      items: [
        makeChallengeDetail("c1", { habitId: "other-habit", status: "active" }),
      ],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    const { result } = renderHook(() => useHabitChallenges("habit-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenges).toEqual([]);
  });

  it("filters out non-active challenges for the habit", async () => {
    fetchChallenges.mockResolvedValue({
      items: [
        makeChallengeDetail("c1", { habitId: "habit-1", status: "completed" }),
        makeChallengeDetail("c2", { habitId: "habit-1", status: "expired" }),
        makeChallengeDetail("c3", { habitId: "habit-1", status: "cancelled" }),
      ],
      page: 1,
      pageSize: 100,
      total: 3,
    });

    const { result } = renderHook(() => useHabitChallenges("habit-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenges).toEqual([]);
  });

  it("returns empty when challenge list is empty", async () => {
    fetchChallenges.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { result } = renderHook(() => useHabitChallenges("habit-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.challenges).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // --- Error conditions ---

  it("sets error when fetchChallenges fails", async () => {
    const apiError = {
      status: 500,
      code: "server_error",
      message: "Internal error",
    };
    fetchChallenges.mockRejectedValue(apiError);

    const { result } = renderHook(() => useHabitChallenges("habit-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.challenges).toEqual([]);
  });
});
