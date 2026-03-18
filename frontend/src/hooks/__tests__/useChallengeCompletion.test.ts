import { renderHook, act, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { useChallengeCompletion } from "../useChallengeCompletion";

const mockFetchChallenges = jest.fn();
const mockFetchChallengesByStatus = jest.fn();
const mockClaimChallenge = jest.fn();

jest.mock("../../api/challenges", () => ({
  fetchChallenges: (...args: unknown[]) => mockFetchChallenges(...args),
  fetchChallengesByStatus: (...args: unknown[]) => mockFetchChallengesByStatus(...args),
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
    progress: 0.75, // 0-1 fraction (backend contract)
    completionCount: 18,
    baselineConsistency: null,
    customStartDate: null,
    customEndDate: null,
    creatorDisplayName: null,
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

describe("useChallengeCompletion — auth gate (winzy.ai-2pb1)", () => {
  it("does not fetch or poll when isAuthenticated is false", async () => {
    const { result } = renderHook(() => useChallengeCompletion(false));

    // No initial fetch
    expect(mockFetchChallenges).not.toHaveBeenCalled();
    expect(mockFetchChallengesByStatus).not.toHaveBeenCalled();
    expect(result.current.current).toBeNull();

    // Advance past poll interval — still nothing
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(mockFetchChallenges).not.toHaveBeenCalled();
    expect(mockFetchChallengesByStatus).not.toHaveBeenCalled();
  });

  it("clears queue when isAuthenticated transitions to false", async () => {
    // Initial load with active challenge
    mockFetchChallenges.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { result, rerender } = renderHook(
      ({ authed }: { authed: boolean }) => useChallengeCompletion(authed),
      { initialProps: { authed: true } },
    );

    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });

    // Poll detects completion
    mockFetchChallengesByStatus.mockResolvedValueOnce({
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

    // Logout — queue should clear
    rerender({ authed: false });

    expect(result.current.current).toBeNull();
  });

  it("stops polling when isAuthenticated becomes false", async () => {
    mockFetchChallenges.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { rerender } = renderHook(
      ({ authed }: { authed: boolean }) => useChallengeCompletion(authed),
      { initialProps: { authed: true } },
    );

    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });

    mockFetchChallenges.mockClear();
    mockFetchChallengesByStatus.mockClear();

    // Logout
    rerender({ authed: false });

    // Advance past multiple poll intervals
    await act(async () => {
      jest.advanceTimersByTime(90_000);
    });

    expect(mockFetchChallenges).not.toHaveBeenCalled();
    expect(mockFetchChallengesByStatus).not.toHaveBeenCalled();
  });

  it("starts fresh polling when isAuthenticated transitions to true", async () => {
    const { rerender } = renderHook(
      ({ authed }: { authed: boolean }) => useChallengeCompletion(authed),
      { initialProps: { authed: false } },
    );

    expect(mockFetchChallenges).not.toHaveBeenCalled();

    // Login
    mockFetchChallenges.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    rerender({ authed: true });

    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });
  });
});

describe("useChallengeCompletion", () => {
  // --- Happy path ---

  it("detects a newly completed challenge after initial load", async () => {
    // Initial load: only active challenges (uses fetchChallenges)
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

    // Next poll: uses filtered endpoint (fetchChallengesByStatus)
    mockFetchChallengesByStatus.mockResolvedValueOnce({
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
    // Verify it used the filtered endpoint
    expect(mockFetchChallengesByStatus).toHaveBeenCalledWith("completed", expect.any(String));
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

    // Poll detects completion (uses filtered endpoint)
    mockFetchChallengesByStatus.mockResolvedValueOnce({
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

    // Both complete (filtered endpoint)
    mockFetchChallengesByStatus.mockResolvedValueOnce({
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

    mockFetchChallengesByStatus.mockResolvedValueOnce({
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

  it("pauses polling when page is hidden and resumes when visible", async () => {
    // Set up web platform + document mock for visibility API
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "web", writable: true });

    const listeners: Record<string, (() => void)[]> = {};
    const mockDocument = {
      hidden: false,
      addEventListener: jest.fn((event: string, handler: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: jest.fn((event: string, handler: () => void) => {
        listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
      }),
    };
    // @ts-expect-error -- partial document mock for visibility test
    globalThis.document = mockDocument;

    mockFetchChallenges.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { unmount } = renderHook(() => useChallengeCompletion());
    await waitFor(() => {
      expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    });

    // Simulate tab going hidden
    mockDocument.hidden = true;
    for (const handler of listeners["visibilitychange"] || []) handler();

    // Advance past a poll interval — should NOT trigger a fetch
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    // Still only the initial call (fetchChallenges), no filtered polls
    expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
    expect(mockFetchChallengesByStatus).not.toHaveBeenCalled();

    // Simulate tab becoming visible again — resumes with filtered endpoint
    mockDocument.hidden = false;
    mockFetchChallengesByStatus.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });
    await act(async () => {
      for (const handler of listeners["visibilitychange"] || []) handler();
    });

    // Should have fetched immediately on becoming visible (via filtered endpoint)
    await waitFor(() => {
      expect(mockFetchChallengesByStatus).toHaveBeenCalledTimes(1);
    });

    unmount();
    // Clean up
    // @ts-expect-error -- remove mock
    delete globalThis.document;
    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
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

    // triggerCheck after initial load uses filtered endpoint
    mockFetchChallengesByStatus.mockResolvedValueOnce({
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

    mockFetchChallengesByStatus.mockResolvedValueOnce({
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

    // Next poll fails (filtered endpoint)
    mockFetchChallengesByStatus.mockRejectedValueOnce(new Error("Network error"));
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(result.current.current).toBeNull();

    // Next poll works fine — recovery
    mockFetchChallengesByStatus.mockResolvedValueOnce({
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
