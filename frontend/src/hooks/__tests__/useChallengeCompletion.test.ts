import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useChallengeCompletion } from "../useChallengeCompletion";

const mockFetchChallenges = jest.fn();
const mockClaimChallenge = jest.fn();

jest.mock("../../api/challenges", () => ({
  fetchChallenges: (...args: unknown[]) => mockFetchChallenges(...args),
  claimChallenge: (...args: unknown[]) => mockClaimChallenge(...args),
}));

function makeChallenge(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch-1",
    habitId: "habit-1",
    creatorId: "creator-1",
    recipientId: "recipient-1",
    milestoneType: "consistencyTarget",
    targetValue: 80,
    periodDays: 30,
    rewardDescription: "Grab coffee together",
    status: "active",
    createdAt: "2026-02-15T00:00:00Z",
    endsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
    completedAt: null,
    claimedAt: null,
    progress: 60,
    completionCount: 18,
    baselineConsistency: null,
    customStartDate: null,
    customEndDate: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useChallengeCompletion", () => {
  // --- Happy path ---

  it("detects a newly completed challenge after initial load", async () => {
    // Initial load: only active challenges
    mockFetchChallenges.mockResolvedValueOnce({
      items: [makeChallenge({ id: "ch-1", status: "active" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    const { result } = renderHook(() => useChallengeCompletion());

    // Wait for initial load
    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });
    expect(result.current.current).toBeNull();

    // Next poll: challenge is now completed
    mockFetchChallenges.mockResolvedValueOnce({
      items: [makeChallenge({ id: "ch-1", status: "completed" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    // Advance timer to trigger poll
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });
    expect(result.current.current?.id).toBe("ch-1");
    expect(result.current.current?.status).toBe("completed");
  });

  it("claim succeeds and removes challenge from queue", async () => {
    // Initial: nothing completed
    mockFetchChallenges.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { result } = renderHook(() => useChallengeCompletion());
    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });

    // Poll detects completion
    mockFetchChallenges.mockResolvedValueOnce({
      items: [makeChallenge({ id: "ch-1", status: "completed" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });

    // Claim
    mockClaimChallenge.mockResolvedValueOnce(makeChallenge({ id: "ch-1", status: "claimed" }));
    await act(async () => {
      await result.current.claim();
    });

    expect(mockClaimChallenge).toHaveBeenCalledWith("ch-1");
    expect(result.current.current).toBeNull();
  });

  // --- Edge cases ---

  it("does not celebrate pre-existing completed challenges on initial load", async () => {
    mockFetchChallenges.mockResolvedValueOnce({
      items: [makeChallenge({ id: "ch-old", status: "completed" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    const { result } = renderHook(() => useChallengeCompletion());
    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });
    expect(result.current.current).toBeNull();
  });

  it("celebrates each challenge when multiple complete simultaneously", async () => {
    // Initial: active
    mockFetchChallenges.mockResolvedValueOnce({
      items: [
        makeChallenge({ id: "ch-1", status: "active" }),
        makeChallenge({ id: "ch-2", status: "active" }),
      ],
      page: 1,
      pageSize: 100,
      total: 2,
    });

    const { result } = renderHook(() => useChallengeCompletion());
    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });

    // Both complete
    mockFetchChallenges.mockResolvedValueOnce({
      items: [
        makeChallenge({ id: "ch-1", status: "completed" }),
        makeChallenge({ id: "ch-2", status: "completed" }),
      ],
      page: 1,
      pageSize: 100,
      total: 2,
    });
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });
    expect(result.current.current?.id).toBe("ch-1");
    expect(result.current.remainingCount).toBe(1);

    // Dismiss first
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.current?.id).toBe("ch-2");
    expect(result.current.remainingCount).toBe(0);

    // Dismiss second
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.current).toBeNull();
  });

  it("handles empty/generic reward description", async () => {
    mockFetchChallenges.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { result } = renderHook(() => useChallengeCompletion());
    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });

    mockFetchChallenges.mockResolvedValueOnce({
      items: [makeChallenge({ id: "ch-empty", status: "completed", rewardDescription: "" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });
    expect(result.current.current?.rewardDescription).toBe("");
  });

  it("triggerCheck forces a refetch (push notification fallback)", async () => {
    mockFetchChallenges.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { result } = renderHook(() => useChallengeCompletion());
    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });

    mockFetchChallenges.mockResolvedValueOnce({
      items: [makeChallenge({ id: "ch-push", status: "completed" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    await act(async () => {
      result.current.triggerCheck();
    });

    await waitFor(() => {
      expect(result.current.current?.id).toBe("ch-push");
    });
  });

  // --- Error conditions ---

  it("claim failure shows error without dismissing overlay", async () => {
    mockFetchChallenges.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { result } = renderHook(() => useChallengeCompletion());
    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });

    mockFetchChallenges.mockResolvedValueOnce({
      items: [makeChallenge({ id: "ch-fail", status: "completed" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });

    // Claim fails
    const claimError = { status: 500, code: "server_error", message: "Server error" };
    mockClaimChallenge.mockRejectedValueOnce(claimError);
    await act(async () => {
      await result.current.claim();
    });

    // Challenge still showing, error present
    expect(result.current.current?.id).toBe("ch-fail");
    expect(result.current.claimError).toEqual(claimError);
    expect(result.current.claiming).toBe(false);
  });

  it("polling failure is non-fatal — no crash, no celebration", async () => {
    mockFetchChallenges.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { result } = renderHook(() => useChallengeCompletion());
    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });

    // Next poll fails
    mockFetchChallenges.mockRejectedValueOnce(new Error("Network error"));
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(result.current.current).toBeNull();

    // Next poll works fine — recovery
    mockFetchChallenges.mockResolvedValueOnce({
      items: [makeChallenge({ id: "ch-recover", status: "completed" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() => {
      expect(result.current.current?.id).toBe("ch-recover");
    });
  });
});
