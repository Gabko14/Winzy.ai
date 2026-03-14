import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { ActiveChallengesSection } from "../ActiveChallengesSection";

const mockFetchChallenges = jest.fn();
const mockFetchChallengeDetail = jest.fn();

jest.mock("../../api/challenges", () => ({
  fetchChallenges: (...args: unknown[]) => mockFetchChallenges(...args),
  fetchChallengeDetail: (...args: unknown[]) => mockFetchChallengeDetail(...args),
}));

function makeChallengeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch-1",
    habitId: "habit-1",
    creatorId: "creator-1",
    recipientId: "recipient-1",
    milestoneType: "consistencyTarget",
    targetValue: 80,
    periodDays: 30,
    rewardDescription: "Get 80% consistency",
    status: "active",
    createdAt: "2026-02-15T00:00:00Z",
    endsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
    completedAt: null,
    claimedAt: null,
    ...overrides,
  };
}

function makeChallengeDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...makeChallengeItem(overrides),
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
});

describe("ActiveChallengesSection", () => {
  it("renders active challenges for a habit", async () => {
    mockFetchChallenges.mockResolvedValue({
      items: [makeChallengeItem()],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    mockFetchChallengeDetail.mockResolvedValue(makeChallengeDetail());

    render(<ActiveChallengesSection habitId="habit-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("active-challenges-section")).toBeTruthy();
    });
    expect(screen.getByText("Active Challenges")).toBeTruthy();
    expect(screen.getByTestId("challenge-progress-card")).toBeTruthy();
  });

  it("renders nothing when no challenges exist", async () => {
    mockFetchChallenges.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });

    const { queryByTestId } = render(<ActiveChallengesSection habitId="habit-1" />);

    await waitFor(() => {
      expect(queryByTestId("active-challenges-section")).toBeNull();
    });
  });

  it("filters challenges by habitId", async () => {
    mockFetchChallenges.mockResolvedValue({
      items: [
        makeChallengeItem({ id: "ch-1", habitId: "habit-1" }),
        makeChallengeItem({ id: "ch-2", habitId: "habit-2" }),
      ],
      page: 1,
      pageSize: 100,
      total: 2,
    });
    mockFetchChallengeDetail.mockResolvedValue(makeChallengeDetail());

    render(<ActiveChallengesSection habitId="habit-1" />);

    await waitFor(() => {
      expect(mockFetchChallengeDetail).toHaveBeenCalledTimes(1);
    });
  });

  it("shows error state on fetch failure", async () => {
    mockFetchChallenges.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Server error",
    });

    render(<ActiveChallengesSection habitId="habit-1" />);

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeTruthy();
    });
  });

  it("shows loading state while fetching", () => {
    mockFetchChallenges.mockReturnValue(new Promise(() => {})); // never resolves

    render(<ActiveChallengesSection habitId="habit-1" />);

    expect(screen.getByText("Loading challenges...")).toBeTruthy();
  });

  it("only shows active challenges, not completed ones", async () => {
    mockFetchChallenges.mockResolvedValue({
      items: [
        makeChallengeItem({ id: "ch-1", habitId: "habit-1", status: "active" }),
        makeChallengeItem({ id: "ch-2", habitId: "habit-1", status: "completed" }),
      ],
      page: 1,
      pageSize: 100,
      total: 2,
    });
    mockFetchChallengeDetail.mockResolvedValue(makeChallengeDetail());

    render(<ActiveChallengesSection habitId="habit-1" />);

    await waitFor(() => {
      // Only the active challenge should trigger a detail fetch
      expect(mockFetchChallengeDetail).toHaveBeenCalledTimes(1);
    });
  });
});
