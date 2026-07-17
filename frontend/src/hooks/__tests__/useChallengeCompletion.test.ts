import { act, waitFor } from "@testing-library/react-native";
import { useChallengeCompletion } from "../useChallengeCompletion";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";

jest.mock("../../api/challenges", () => ({
  fetchChallenges: jest.fn(),
  claimChallenge: jest.fn(),
}));

const { fetchChallenges, claimChallenge } = jest.requireMock("../../api/challenges");

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
    progress: 0.75,
    completionCount: 18,
    baselineConsistency: null,
    customStartDate: null,
    customEndDate: null,
    creatorDisplayName: null,
    ...overrides,
  };
}

function makePage(items: ReturnType<typeof makeChallenge>[]) {
  return { items, page: 1, pageSize: 100, total: items.length };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function flushPromises() {
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
}

describe("useChallengeCompletion — auth gate", () => {
  it("does not fetch or poll when isAuthenticated is false", async () => {
    const { result } = renderHookWithQueryClient(() => useChallengeCompletion(false));

    await flushPromises();

    expect(fetchChallenges).not.toHaveBeenCalled();
    expect(result.current.current).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(fetchChallenges).not.toHaveBeenCalled();
  });

  it("clears queue when isAuthenticated transitions to false", async () => {
    fetchChallenges.mockResolvedValueOnce(makePage([]));

    const { result, rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => useChallengeCompletion(authed),
      { initialProps: { authed: true } },
    );

    await flushPromises();

    fetchChallenges.mockResolvedValueOnce(
      makePage([makeChallenge({ id: "ch-1", status: "completed" })]),
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });

    rerender({ authed: false });

    expect(result.current.current).toBeNull();
    expect(result.current.queueLength).toBe(0);
  });

  it("stops polling when isAuthenticated becomes false", async () => {
    fetchChallenges.mockResolvedValue(makePage([]));

    const { rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => useChallengeCompletion(authed),
      { initialProps: { authed: true } },
    );

    await flushPromises();
    expect(fetchChallenges).toHaveBeenCalledTimes(1);

    fetchChallenges.mockClear();
    rerender({ authed: false });

    await act(async () => {
      jest.advanceTimersByTime(90_000);
    });

    expect(fetchChallenges).not.toHaveBeenCalled();
  });

  it("starts fresh polling when isAuthenticated transitions to true", async () => {
    const { rerender } = renderHookWithQueryClient(
      ({ authed }: { authed: boolean }) => useChallengeCompletion(authed),
      { initialProps: { authed: false } },
    );

    await flushPromises();
    expect(fetchChallenges).not.toHaveBeenCalled();

    fetchChallenges.mockResolvedValueOnce(makePage([]));
    rerender({ authed: true });

    await flushPromises();
    expect(fetchChallenges).toHaveBeenCalledTimes(1);
  });
});

describe("useChallengeCompletion", () => {
  it("detects a newly completed challenge after initial load", async () => {
    fetchChallenges.mockResolvedValueOnce(
      makePage([makeChallenge({ id: "ch-1", status: "active" })]),
    );

    const { result } = renderHookWithQueryClient(() => useChallengeCompletion());

    await flushPromises();
    expect(result.current.current).toBeNull();

    fetchChallenges.mockResolvedValueOnce(
      makePage([makeChallenge({ id: "ch-1", status: "completed" })]),
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });

    expect(result.current.current?.id).toBe("ch-1");
    expect(result.current.current?.status).toBe("completed");
  });

  it("claim succeeds and removes challenge from queue", async () => {
    fetchChallenges.mockResolvedValueOnce(makePage([]));

    const { result } = renderHookWithQueryClient(() => useChallengeCompletion());

    await flushPromises();

    fetchChallenges.mockResolvedValueOnce(
      makePage([makeChallenge({ id: "ch-1", status: "completed" })]),
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });

    claimChallenge.mockResolvedValueOnce(makeChallenge({ id: "ch-1", status: "claimed" }));
    fetchChallenges.mockResolvedValue(makePage([]));

    await act(async () => {
      await result.current.claim();
    });
    await flushPromises();

    expect(claimChallenge).toHaveBeenCalledWith("ch-1");
    expect(result.current.current).toBeNull();
  });

  it("does not celebrate pre-existing completed challenges on initial load", async () => {
    fetchChallenges.mockResolvedValueOnce(
      makePage([makeChallenge({ id: "ch-old", status: "completed" })]),
    );

    const { result } = renderHookWithQueryClient(() => useChallengeCompletion());

    await flushPromises();

    expect(result.current.current).toBeNull();
    expect(result.current.queueLength).toBe(0);
  });

  it("does not celebrate pre-existing claimed challenges on initial load", async () => {
    fetchChallenges.mockResolvedValueOnce(
      makePage([makeChallenge({ id: "ch-old", status: "claimed" })]),
    );

    const { result } = renderHookWithQueryClient(() => useChallengeCompletion());

    await flushPromises();

    expect(result.current.current).toBeNull();
  });

  it("celebrates each challenge when multiple complete simultaneously", async () => {
    fetchChallenges.mockResolvedValueOnce(
      makePage([
        makeChallenge({ id: "ch-1", status: "active" }),
        makeChallenge({ id: "ch-2", status: "active" }),
      ]),
    );

    const { result } = renderHookWithQueryClient(() => useChallengeCompletion());

    await flushPromises();

    fetchChallenges.mockResolvedValueOnce(
      makePage([
        makeChallenge({ id: "ch-1", status: "completed" }),
        makeChallenge({ id: "ch-2", status: "completed" }),
      ]),
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });

    expect(result.current.current?.id).toBe("ch-1");
    expect(result.current.queueLength).toBe(2);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.current?.id).toBe("ch-2");
    expect(result.current.queueLength).toBe(1);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.current).toBeNull();
    expect(result.current.queueLength).toBe(0);
  });

  it("handles empty reward description", async () => {
    fetchChallenges.mockResolvedValueOnce(makePage([]));

    const { result } = renderHookWithQueryClient(() => useChallengeCompletion());

    await flushPromises();

    fetchChallenges.mockResolvedValueOnce(
      makePage([
        makeChallenge({ id: "ch-empty", status: "completed", rewardDescription: "" }),
      ]),
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });

    expect(result.current.current?.rewardDescription).toBe("");
  });

  it("triggerCheck forces a refetch", async () => {
    fetchChallenges.mockResolvedValueOnce(makePage([]));

    const { result } = renderHookWithQueryClient(() => useChallengeCompletion());

    await flushPromises();

    fetchChallenges.mockResolvedValueOnce(
      makePage([makeChallenge({ id: "ch-push", status: "completed" })]),
    );

    await act(async () => {
      result.current.triggerCheck();
    });
    await flushPromises();

    await waitFor(() => {
      expect(result.current.current?.id).toBe("ch-push");
    });
  });

  it("triggerCheck is a no-op when not authenticated", async () => {
    const { result } = renderHookWithQueryClient(() => useChallengeCompletion(false));

    await act(async () => {
      result.current.triggerCheck();
    });
    await flushPromises();

    expect(fetchChallenges).not.toHaveBeenCalled();
  });

  it("claim failure shows error without dismissing overlay", async () => {
    fetchChallenges.mockResolvedValueOnce(makePage([]));

    const { result } = renderHookWithQueryClient(() => useChallengeCompletion());

    await flushPromises();

    fetchChallenges.mockResolvedValueOnce(
      makePage([makeChallenge({ id: "ch-fail", status: "completed" })]),
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    await waitFor(() => {
      expect(result.current.current).not.toBeNull();
    });

    const claimError = { status: 500, code: "server_error", message: "Server error" };
    claimChallenge.mockRejectedValueOnce(claimError);

    await act(async () => {
      await result.current.claim();
    });
    await flushPromises();

    expect(result.current.current?.id).toBe("ch-fail");
    expect(result.current.claimError).toEqual(claimError);
    expect(result.current.claiming).toBe(false);
  });

  it("polling failure is non-fatal — no crash, no celebration", async () => {
    fetchChallenges
      .mockResolvedValueOnce(makePage([]))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(
        makePage([makeChallenge({ id: "ch-recover", status: "completed" })]),
      );

    const { result } = renderHookWithQueryClient(() => useChallengeCompletion());

    await flushPromises();
    expect(result.current.current).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    expect(result.current.current).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flushPromises();

    await waitFor(() => {
      expect(result.current.current?.id).toBe("ch-recover");
    });
  });
});
