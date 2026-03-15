import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react-native";
import { MyChallengesScreen } from "../MyChallengesScreen";

const mockFetchChallenges = jest.fn();

jest.mock("../../api/challenges", () => ({
  fetchChallenges: (...args: unknown[]) => mockFetchChallenges(...args),
}));

function makeChallengeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch-1",
    habitId: "habit-1",
    creatorId: "creator-1",
    recipientId: "recipient-1",
    milestoneType: "consistencyTarget",
    targetValue: 80,
    periodDays: 30,
    rewardDescription: "Reach 80% consistency",
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
});

describe("MyChallengesScreen", () => {
  it("shows loading state initially", () => {
    mockFetchChallenges.mockReturnValue(new Promise(() => {}));
    render(<MyChallengesScreen />);
    expect(screen.getByTestId("challenges-loading")).toBeTruthy();
    expect(screen.getByText("Loading your challenges...")).toBeTruthy();
  });

  it("shows error state on fetch failure", async () => {
    mockFetchChallenges.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Something went wrong on our end. Please try again.",
    });
    render(<MyChallengesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("challenges-error")).toBeTruthy();
    });
    expect(screen.getByText("Something went wrong on our end. Please try again.")).toBeTruthy();
  });

  it("shows empty state when no challenges exist", async () => {
    mockFetchChallenges.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });
    render(<MyChallengesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("my-challenges-screen")).toBeTruthy();
    });
    expect(screen.getByText("No challenges yet")).toBeTruthy();
  });

  it("renders active challenges section", async () => {
    mockFetchChallenges.mockResolvedValue({
      items: [makeChallengeDetail({ status: "active" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    render(<MyChallengesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("active-challenges-list")).toBeTruthy();
    });
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("renders completed challenges section", async () => {
    mockFetchChallenges.mockResolvedValue({
      items: [makeChallengeDetail({ id: "ch-2", status: "completed" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    render(<MyChallengesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("completed-challenges-list")).toBeTruthy();
    });
    expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(1);
  });

  it("renders expired challenges section", async () => {
    mockFetchChallenges.mockResolvedValue({
      items: [makeChallengeDetail({ id: "ch-3", status: "expired" })],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    render(<MyChallengesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("expired-challenges-list")).toBeTruthy();
    });
    expect(screen.getByText("Past")).toBeTruthy();
  });

  it("calls onBack when back button is pressed", async () => {
    const onBack = jest.fn();
    mockFetchChallenges.mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 });

    render(<MyChallengesScreen onBack={onBack} />);
    await waitFor(() => {
      expect(screen.getByTestId("back-button")).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId("back-button"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("does not render back button when onBack is not provided", async () => {
    mockFetchChallenges.mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 });

    render(<MyChallengesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("my-challenges-screen")).toBeTruthy();
    });
    expect(screen.queryByTestId("back-button")).toBeNull();
  });

  it("renders My Challenges title", async () => {
    mockFetchChallenges.mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 });

    render(<MyChallengesScreen />);
    await waitFor(() => {
      expect(screen.getByText("My Challenges")).toBeTruthy();
    });
  });

  it("does not call fetchChallengeDetail — list endpoint includes all fields", async () => {
    mockFetchChallenges.mockResolvedValue({
      items: [
        makeChallengeDetail({ id: "ch-1", status: "active" }),
        makeChallengeDetail({ id: "ch-2", status: "completed" }),
      ],
      page: 1,
      pageSize: 100,
      total: 2,
    });

    render(<MyChallengesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("active-challenges-list")).toBeTruthy();
    });
    // Only fetchChallenges should be called, never fetchChallengeDetail
    expect(mockFetchChallenges).toHaveBeenCalledTimes(1);
  });
});
