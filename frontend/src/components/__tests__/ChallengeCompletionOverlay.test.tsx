import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ChallengeCompletionOverlay } from "../ChallengeCompletionOverlay";
import type { ChallengeDetail } from "../../api/challenges";

function makeChallenge(overrides: Partial<ChallengeDetail> = {}): ChallengeDetail {
  return {
    id: "ch-1",
    habitId: "habit-1",
    creatorId: "creator-1",
    recipientId: "recipient-1",
    milestoneType: "consistencyTarget",
    targetValue: 80,
    periodDays: 30,
    rewardDescription: "Grab coffee together",
    status: "completed",
    createdAt: "2026-02-15T00:00:00Z",
    endsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
    completedAt: "2026-03-10T00:00:00Z",
    claimedAt: null,
    progress: 1.0, // 0-1 fraction (completed challenge)
    completionCount: 24,
    baselineConsistency: null,
    customStartDate: null,
    customEndDate: null,
    ...overrides,
  };
}

describe("ChallengeCompletionOverlay", () => {
  it("renders celebration heading and challenge title", () => {
    render(
      <ChallengeCompletionOverlay
        challenge={makeChallenge()}
        claiming={false}
        claimError={null}
        remainingCount={0}
        onClaim={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.getByTestId("celebration-heading")).toBeTruthy();
    expect(screen.getByText("Challenge Complete!")).toBeTruthy();
    expect(screen.getByTestId("celebration-challenge-title")).toBeTruthy();
    expect(screen.getByText("Reach 80% consistency")).toBeTruthy();
  });

  it("shows reward description when present", () => {
    render(
      <ChallengeCompletionOverlay
        challenge={makeChallenge({ rewardDescription: "Play tennis" })}
        claiming={false}
        claimError={null}
        remainingCount={0}
        onClaim={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.getByTestId("celebration-reward")).toBeTruthy();
    expect(screen.getByText("Play tennis")).toBeTruthy();
    expect(screen.getByText("Time to celebrate together")).toBeTruthy();
  });

  it("shows generic message when reward description is empty", () => {
    render(
      <ChallengeCompletionOverlay
        challenge={makeChallenge({ rewardDescription: "" })}
        claiming={false}
        claimError={null}
        remainingCount={0}
        onClaim={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.getByTestId("celebration-reward-generic")).toBeTruthy();
    expect(screen.getByText("You did it! Your consistency paid off.")).toBeTruthy();
  });

  it("calls onClaim when claim button is pressed", () => {
    const onClaim = jest.fn();
    render(
      <ChallengeCompletionOverlay
        challenge={makeChallenge()}
        claiming={false}
        claimError={null}
        remainingCount={0}
        onClaim={onClaim}
        onDismiss={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByLabelText("Let's celebrate!"));
    expect(onClaim).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when Later button is pressed", () => {
    const onDismiss = jest.fn();
    render(
      <ChallengeCompletionOverlay
        challenge={makeChallenge()}
        claiming={false}
        claimError={null}
        remainingCount={0}
        onClaim={jest.fn()}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.press(screen.getByLabelText("Later"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows claim error and retry button on failure", () => {
    render(
      <ChallengeCompletionOverlay
        challenge={makeChallenge()}
        claiming={false}
        claimError={{ status: 500, code: "server_error", message: "Server error" }}
        remainingCount={0}
        onClaim={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.getByTestId("celebration-claim-error")).toBeTruthy();
    expect(screen.getByText(/try that again/i)).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("shows remaining count badge when multiple challenges completed", () => {
    render(
      <ChallengeCompletionOverlay
        challenge={makeChallenge()}
        claiming={false}
        claimError={null}
        remainingCount={2}
        onClaim={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.getByTestId("celebration-remaining-badge")).toBeTruthy();
    expect(screen.getByText("2 more challenges completed")).toBeTruthy();
  });

  it("does not show remaining badge when count is 0", () => {
    render(
      <ChallengeCompletionOverlay
        challenge={makeChallenge()}
        claiming={false}
        claimError={null}
        remainingCount={0}
        onClaim={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.queryByTestId("celebration-remaining-badge")).toBeNull();
  });

  it("shows singular text for 1 remaining challenge", () => {
    render(
      <ChallengeCompletionOverlay
        challenge={makeChallenge()}
        claiming={false}
        claimError={null}
        remainingCount={1}
        onClaim={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.getByText("1 more challenge completed")).toBeTruthy();
  });
});
