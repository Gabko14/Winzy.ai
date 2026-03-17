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

/**
 * Backend returns progress as a 0.0–1.0 fraction (ProgressCalculator.CalculateProgress).
 * Default: 0.9 means 90% of the way to the target (e.g., 72/80 consistency).
 */
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
    progress: 0.9, // 0-1 fraction: 72/80 = 0.9
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
    // progress=0.7 means 70% of the way to target -> "onTrack" (50-89%)
    const challenge = makeChallengeDetail({ progress: 0.7, targetValue: 80 });
    render(<ChallengeProgressCard challenge={challenge} />);

    expect(screen.getByText("You're doing great! Keep it up!")).toBeTruthy();
    expect(screen.getByTestId("challenge-trend-badge")).toBeTruthy();
  });

  // --- Happy path: almost-there message at 90%+ progress ---

  it("shows almost-there message at 90%+ progress", () => {
    // progress=0.94 means 94% of the way to target -> "almostThere" (>=90%)
    const challenge = makeChallengeDetail({ progress: 0.94, targetValue: 80 });
    render(<ChallengeProgressCard challenge={challenge} />);

    expect(screen.getByText("So close! Just a little more!")).toBeTruthy();
  });

  // --- Happy path: needs-push message at <50% progress ---

  it("shows needs-push message at less than 50% progress with supportive tone", () => {
    // progress=0.375 means 37.5% of the way to target -> "needsPush" (<50%)
    const challenge = makeChallengeDetail({ progress: 0.375, targetValue: 80 });
    render(<ChallengeProgressCard challenge={challenge} />);

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
      progress: 0.75, // 75% of the way to target
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
          progress: 0.625, // 62.5% toward target
          endsAt: new Date(Date.now() - 1000).toISOString(),
          status: "active",
        }),
      ),
    ).toBe("grace");
  });

  it("returns almostThere at 90%+ progress", () => {
    // progress=0.94 -> 94% -> almostThere
    expect(
      getTrendIndicator(makeChallengeDetail({ progress: 0.94, targetValue: 80 })),
    ).toBe("almostThere");
  });

  it("returns onTrack at 50-89%", () => {
    // progress=0.625 -> 62.5% -> onTrack
    expect(
      getTrendIndicator(makeChallengeDetail({ progress: 0.625, targetValue: 80 })),
    ).toBe("onTrack");
  });

  it("returns needsPush below 50%", () => {
    // progress=0.25 -> 25% -> needsPush
    expect(
      getTrendIndicator(makeChallengeDetail({ progress: 0.25, targetValue: 80 })),
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
  it("converts 0-1 fraction to 0-100 percentage", () => {
    expect(getProgressPercent(makeChallengeDetail({ progress: 0.5 }))).toBe(50);
  });

  it("caps at 100%", () => {
    expect(getProgressPercent(makeChallengeDetail({ progress: 1.2 }))).toBe(100);
  });

  it("clamps negative to 0", () => {
    expect(getProgressPercent(makeChallengeDetail({ progress: -0.1 }))).toBe(0);
  });

  it("returns 0 for zero progress", () => {
    expect(getProgressPercent(makeChallengeDetail({ progress: 0 }))).toBe(0);
  });

  it("returns 100 for progress=1.0 (fully complete)", () => {
    expect(getProgressPercent(makeChallengeDetail({ progress: 1.0 }))).toBe(100);
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

// --- Regression: backend/frontend progress contract alignment ---
// These tests verify that the frontend correctly interprets the backend's
// 0.0–1.0 fractional progress values from ProgressCalculator.CalculateProgress.
// If these break, the two sides have drifted.

describe("backend contract regression", () => {
  it("displays correct progress for consistencyTarget (backend: consistency/targetValue)", () => {
    // Backend: consistency=40, target=80 -> CalculateProgress returns 0.5
    const challenge = makeChallengeDetail({
      milestoneType: "consistencyTarget",
      progress: 0.5,
      targetValue: 80,
    });
    expect(getProgressPercent(challenge)).toBe(50);
    render(<ChallengeProgressCard challenge={challenge} />);
    expect(screen.getByText("40% → 80%")).toBeTruthy();
  });

  it("displays correct progress for daysInPeriod (backend: completionCount/targetValue)", () => {
    // Backend: completionCount=10, target=20 -> CalculateProgress returns 0.5
    const challenge = makeChallengeDetail({
      milestoneType: "daysInPeriod",
      progress: 0.5,
      targetValue: 20,
      completionCount: 10,
    });
    expect(getProgressPercent(challenge)).toBe(50);
    render(<ChallengeProgressCard challenge={challenge} />);
    expect(screen.getByText("10 / 20")).toBeTruthy();
  });

  it("displays correct progress for totalCompletions (backend: completionCount/targetValue)", () => {
    // Backend: completionCount=33, target=100 -> CalculateProgress returns 0.33
    const challenge = makeChallengeDetail({
      milestoneType: "totalCompletions",
      progress: 0.33,
      targetValue: 100,
      completionCount: 33,
    });
    expect(getProgressPercent(challenge)).toBe(33);
    render(<ChallengeProgressCard challenge={challenge} />);
    expect(screen.getByText("33 / 100")).toBeTruthy();
  });

  it("displays correct progress for improvementMilestone (backend: improvement/targetValue)", () => {
    // Backend: baseline=50, current=60, targetImprovement=20 -> improvement=10, progress=0.5
    const challenge = makeChallengeDetail({
      milestoneType: "improvementMilestone",
      progress: 0.5,
      targetValue: 20,
      baselineConsistency: 50,
    });
    expect(getProgressPercent(challenge)).toBe(50);
    render(<ChallengeProgressCard challenge={challenge} />);
    expect(screen.getByText("10% → 20%")).toBeTruthy();
  });

  it("shows 100% progress bar when backend returns 1.0 (milestone reached)", () => {
    const challenge = makeChallengeDetail({
      progress: 1.0,
      targetValue: 80,
      status: "completed",
    });
    expect(getProgressPercent(challenge)).toBe(100);
  });

  it("handles fractional progress near boundaries correctly", () => {
    // 89.9% should be onTrack, not almostThere
    expect(getTrendIndicator(makeChallengeDetail({ progress: 0.899 }))).toBe("onTrack");
    // 90% should be almostThere
    expect(getTrendIndicator(makeChallengeDetail({ progress: 0.9 }))).toBe("almostThere");
    // 49.9% should be needsPush
    expect(getTrendIndicator(makeChallengeDetail({ progress: 0.499 }))).toBe("needsPush");
    // 50% should be onTrack
    expect(getTrendIndicator(makeChallengeDetail({ progress: 0.5 }))).toBe("onTrack");
  });
});
