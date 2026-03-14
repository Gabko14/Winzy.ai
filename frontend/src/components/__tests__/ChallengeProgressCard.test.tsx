import React from "react";
import { render, screen } from "@testing-library/react-native";
import {
  ChallengeProgressCard,
  getChallengeTitle,
  getTrendIndicator,
  getEncouragementMessage,
  getProgressPercent,
  getDaysRemaining,
} from "../ChallengeProgressCard";
import type { ChallengeDetail } from "../../api/challenges";

function makeChallengeDetail(overrides: Partial<ChallengeDetail> = {}): ChallengeDetail {
  return {
    id: "ch-1",
    habitId: "habit-1",
    creatorId: "creator-1",
    recipientId: "recipient-1",
    milestoneType: "consistencyTarget",
    targetValue: 80,
    periodDays: 30,
    rewardDescription: "Let's grab coffee together!",
    status: "active",
    progress: 72,
    completionCount: 22,
    baselineConsistency: null,
    customStartDate: null,
    customEndDate: null,
    createdAt: "2026-02-15T00:00:00Z",
    endsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days from now
    completedAt: null,
    claimedAt: null,
    ...overrides,
  };
}

describe("ChallengeProgressCard", () => {
  // --- Happy path: renders with all data ---

  it("renders challenge progress card with title, progress bar, days remaining, friend info", () => {
    const challenge = makeChallengeDetail();
    render(<ChallengeProgressCard challenge={challenge} creatorName="Alex" />);

    expect(screen.getByTestId("challenge-progress-card")).toBeTruthy();
    expect(screen.getByTestId("challenge-title")).toBeTruthy();
    expect(screen.getByText("Reach 80% consistency")).toBeTruthy();
    expect(screen.getByTestId("challenge-reward")).toBeTruthy();
    expect(screen.getByText("Reward: Let's grab coffee together!")).toBeTruthy();
    expect(screen.getByTestId("challenge-progress-bar")).toBeTruthy();
    expect(screen.getByTestId("challenge-days-remaining")).toBeTruthy();
    expect(screen.getByTestId("challenge-creator")).toBeTruthy();
    expect(screen.getByText("Set by Alex")).toBeTruthy();
    expect(screen.getByTestId("challenge-progress-value")).toBeTruthy();
    expect(screen.getByText("72% → 80%")).toBeTruthy();
  });

  // --- Happy path: on-track encouragement at 70%+ progress ---

  it("shows on-track encouragement message at 70%+ progress", () => {
    // 72/80 = 90% of target -> this is "almostThere"
    // For "onTrack" we need 50-89% of target
    const challenge = makeChallengeDetail({ progress: 56, targetValue: 80 });
    render(<ChallengeProgressCard challenge={challenge} />);

    // 56/80 = 70% -> onTrack
    expect(screen.getByText("You're doing great! Keep it up!")).toBeTruthy();
    expect(screen.getByTestId("challenge-trend-badge")).toBeTruthy();
  });

  // --- Happy path: almost-there message at 90%+ progress ---

  it("shows almost-there message at 90%+ progress", () => {
    const challenge = makeChallengeDetail({ progress: 75, targetValue: 80 });
    render(<ChallengeProgressCard challenge={challenge} />);

    // 75/80 = 93.75% -> almostThere
    expect(screen.getByText("So close! Just a little more!")).toBeTruthy();
  });

  // --- Happy path: needs-push message at <50% progress ---

  it("shows needs-push message at less than 50% progress with supportive tone", () => {
    const challenge = makeChallengeDetail({ progress: 30, targetValue: 80 });
    render(<ChallengeProgressCard challenge={challenge} />);

    // 30/80 = 37.5% -> needsPush
    expect(screen.getByText("Every day counts. You've got this!")).toBeTruthy();
  });

  // --- Edge case: 0% progress on new challenge ---

  it("shows starting encouragement at 0% progress on brand new challenge", () => {
    const challenge = makeChallengeDetail({ progress: 0 });
    render(<ChallengeProgressCard challenge={challenge} />);

    expect(screen.getByText("A new challenge awaits. You've got this!")).toBeTruthy();
  });

  // --- Edge case: 0 days remaining but not complete ---

  it("shows grace state when challenge has 0 days remaining but is not complete", () => {
    const challenge = makeChallengeDetail({
      progress: 60,
      targetValue: 80,
      endsAt: new Date(Date.now() - 1000).toISOString(), // past
      status: "active",
    });
    render(<ChallengeProgressCard challenge={challenge} />);

    expect(screen.getByText("Time's up")).toBeTruthy();
    expect(screen.getByText("Time's up, but every effort counts!")).toBeTruthy();
  });

  // --- Edge case: multiple active challenges on same habit render independently ---

  it("renders multiple challenge cards independently", () => {
    const challenge1 = makeChallengeDetail({ id: "ch-1", rewardDescription: "Reward One" });
    const challenge2 = makeChallengeDetail({ id: "ch-2", rewardDescription: "Reward Two" });

    const { unmount } = render(<ChallengeProgressCard challenge={challenge1} />);
    expect(screen.getByText("Reward: Reward One")).toBeTruthy();
    unmount();

    render(<ChallengeProgressCard challenge={challenge2} />);
    expect(screen.getByText("Reward: Reward Two")).toBeTruthy();
  });

  // --- Error condition: unknown or null milestoneType renders gracefully ---

  it("renders gracefully with unknown milestoneType", () => {
    const challenge = makeChallengeDetail({
      milestoneType: "unknownType" as any,
    });
    render(<ChallengeProgressCard challenge={challenge} />);

    // Should render the card without crashing
    expect(screen.getByTestId("challenge-progress-card")).toBeTruthy();
    // Both title and milestone badge fall back to "Challenge"
    expect(screen.getAllByText("Challenge").length).toBeGreaterThanOrEqual(1);
  });
});

// --- Unit tests for helper functions ---

describe("getChallengeTitle", () => {
  it("generates title for consistencyTarget", () => {
    expect(getChallengeTitle(makeChallengeDetail({ milestoneType: "consistencyTarget", targetValue: 80 }))).toBe("Reach 80% consistency");
  });

  it("generates title for daysInPeriod", () => {
    expect(getChallengeTitle(makeChallengeDetail({ milestoneType: "daysInPeriod", targetValue: 20, periodDays: 30 }))).toBe("Complete 20 days in 30-day period");
  });

  it("generates title for totalCompletions", () => {
    expect(getChallengeTitle(makeChallengeDetail({ milestoneType: "totalCompletions", targetValue: 50 }))).toBe("Reach 50 total completions");
  });

  it("generates title for customDateRange", () => {
    expect(getChallengeTitle(makeChallengeDetail({ milestoneType: "customDateRange", targetValue: 75 }))).toBe("Reach 75% in custom range");
  });

  it("generates title for improvementMilestone", () => {
    expect(getChallengeTitle(makeChallengeDetail({ milestoneType: "improvementMilestone", targetValue: 15 }))).toBe("Improve by 15%");
  });

  it("falls back to 'Challenge' for unknown type", () => {
    expect(getChallengeTitle(makeChallengeDetail({ milestoneType: "unknown" as any }))).toBe("Challenge");
  });
});

describe("getTrendIndicator", () => {
  it("returns completed for completed challenges", () => {
    expect(getTrendIndicator(makeChallengeDetail({ status: "completed" }))).toBe("completed");
  });

  it("returns completed for claimed challenges", () => {
    expect(getTrendIndicator(makeChallengeDetail({ status: "claimed" }))).toBe("completed");
  });

  it("returns starting for 0 progress", () => {
    expect(getTrendIndicator(makeChallengeDetail({ progress: 0 }))).toBe("starting");
  });

  it("returns grace when expired but active", () => {
    expect(
      getTrendIndicator(
        makeChallengeDetail({
          progress: 50,
          endsAt: new Date(Date.now() - 1000).toISOString(),
          status: "active",
        }),
      ),
    ).toBe("grace");
  });

  it("returns almostThere at 90%+ progress", () => {
    expect(
      getTrendIndicator(makeChallengeDetail({ progress: 75, targetValue: 80 })),
    ).toBe("almostThere");
  });

  it("returns onTrack at 50-89%", () => {
    expect(
      getTrendIndicator(makeChallengeDetail({ progress: 50, targetValue: 80 })),
    ).toBe("onTrack");
  });

  it("returns needsPush below 50%", () => {
    expect(
      getTrendIndicator(makeChallengeDetail({ progress: 20, targetValue: 80 })),
    ).toBe("needsPush");
  });
});

describe("getEncouragementMessage", () => {
  it("returns correct message for each trend", () => {
    expect(getEncouragementMessage("onTrack")).toBe("You're doing great! Keep it up!");
    expect(getEncouragementMessage("needsPush")).toBe("Every day counts. You've got this!");
    expect(getEncouragementMessage("almostThere")).toBe("So close! Just a little more!");
    expect(getEncouragementMessage("completed")).toBe("Challenge complete! Time to celebrate!");
    expect(getEncouragementMessage("starting")).toBe("A new challenge awaits. You've got this!");
    expect(getEncouragementMessage("grace")).toBe("Time's up, but every effort counts!");
  });
});

describe("getProgressPercent", () => {
  it("calculates correct percentage", () => {
    expect(getProgressPercent(makeChallengeDetail({ progress: 40, targetValue: 80 }))).toBe(50);
  });

  it("caps at 100%", () => {
    expect(getProgressPercent(makeChallengeDetail({ progress: 100, targetValue: 80 }))).toBe(100);
  });

  it("returns 0 for targetValue 0", () => {
    expect(getProgressPercent(makeChallengeDetail({ targetValue: 0 }))).toBe(0);
  });
});

describe("getDaysRemaining", () => {
  it("returns 0 for past dates", () => {
    expect(
      getDaysRemaining(makeChallengeDetail({ endsAt: new Date(Date.now() - 86400000).toISOString() })),
    ).toBe(0);
  });

  it("returns positive days for future dates", () => {
    const daysRemaining = getDaysRemaining(
      makeChallengeDetail({ endsAt: new Date(Date.now() + 5 * 86400000).toISOString() }),
    );
    expect(daysRemaining).toBeGreaterThanOrEqual(4);
    expect(daysRemaining).toBeLessThanOrEqual(6);
  });
});
