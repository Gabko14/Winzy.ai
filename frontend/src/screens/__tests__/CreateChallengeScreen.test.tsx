import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { CreateChallengeScreen } from "../CreateChallengeScreen";
import type { FriendProfileResponse, FriendHabit } from "../../api/social";
import type { Challenge } from "../../api/challenges";
import type { ApiError } from "../../api/types";

// --- Mocks ---

const mockFetchFriendProfile = jest.fn<Promise<FriendProfileResponse>, [string]>();
const mockCreateChallenge = jest.fn<Promise<Challenge>, [unknown]>();

jest.mock("../../api/social", () => ({
  ...jest.requireActual("../../api/social"),
  fetchFriendProfile: (...args: [string]) => mockFetchFriendProfile(...args),
}));

jest.mock("../../api/challenges", () => ({
  ...jest.requireActual("../../api/challenges"),
  createChallenge: (...args: [unknown]) => mockCreateChallenge(...args),
}));

// --- Helpers ---

function makeHabit(overrides: Partial<FriendHabit> = {}): FriendHabit {
  return {
    id: "habit-1",
    name: "Exercise",
    icon: null,
    color: null,
    consistency: 65,
    flameLevel: "strong",
    ...overrides,
  };
}

function makeProfile(overrides: Partial<FriendProfileResponse> = {}): FriendProfileResponse {
  return {
    friendId: "friend-123",
    habits: [makeHabit()],
    ...overrides,
  };
}

function makeChallenge(): Challenge {
  return {
    id: "challenge-1",
    habitId: "habit-1",
    creatorId: "me",
    recipientId: "friend-123",
    milestoneType: "consistencyTarget",
    targetValue: 60,
    periodDays: 30,
    rewardDescription: "Go hiking together",
    status: "active",
    createdAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    completedAt: null,
    claimedAt: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchFriendProfile.mockResolvedValue(makeProfile());
  mockCreateChallenge.mockResolvedValue(makeChallenge());
});

describe("CreateChallengeScreen", () => {
  // --- Happy path: step-by-step flow ---

  it("completes the full flow: select habit -> set target -> describe reward -> preview -> confirm", async () => {
    const habits = [
      makeHabit({ id: "h1", name: "Meditate", consistency: 70, flameLevel: "strong" }),
      makeHabit({ id: "h2", name: "Read", consistency: 40, flameLevel: "steady" }),
    ];
    mockFetchFriendProfile.mockResolvedValue(makeProfile({ habits }));
    const onComplete = jest.fn();

    const { getByTestId, getByText, getByRole } = render(
      <CreateChallengeScreen
        friendId="friend-123"
        friendName="Alice"
        onComplete={onComplete}
      />,
    );

    // Step 1: Select habit
    await waitFor(() => {
      expect(getByTestId("step-1-select-habit")).toBeTruthy();
    });
    expect(getByText("Choose a habit to challenge")).toBeTruthy();
    expect(getByTestId("habit-option-h1")).toBeTruthy();
    expect(getByTestId("habit-option-h2")).toBeTruthy();

    // Select Meditate
    fireEvent.press(getByTestId("habit-option-h1"));

    // Continue to step 2
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));

    await waitFor(() => {
      expect(getByTestId("step-2-set-target")).toBeTruthy();
    });

    // Step 2: Set target (default 60%, 30 days)
    expect(getByTestId("target-value")).toBeTruthy();
    expect(getByTestId("period-presets")).toBeTruthy();

    // Increase target to 65%
    fireEvent.press(getByTestId("target-increase"));

    // Continue to step 3
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));

    await waitFor(() => {
      expect(getByTestId("step-3-reward")).toBeTruthy();
    });

    // Step 3: Describe reward
    expect(getByText("What will you do together?")).toBeTruthy();
    fireEvent.changeText(getByTestId("reward-input"), "Go hiking at the park");

    // Continue to step 4
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));

    await waitFor(() => {
      expect(getByTestId("step-4-preview")).toBeTruthy();
    });

    // Step 4: Preview
    expect(getByTestId("preview-friend")).toBeTruthy();
    expect(getByText("Alice")).toBeTruthy();
    expect(getByTestId("preview-habit")).toBeTruthy();
    expect(getByTestId("preview-target")).toBeTruthy();
    expect(getByTestId("preview-reward")).toBeTruthy();
    expect(getByText("Go hiking at the park")).toBeTruthy();

    // Submit
    await act(async () => {
      fireEvent.press(getByRole("button", { name: "Send challenge" }));
    });

    // Step 5: Success
    await waitFor(() => {
      expect(getByTestId("create-challenge-success")).toBeTruthy();
    });
    expect(getByText("Challenge sent!")).toBeTruthy();

    // Verify API was called correctly
    expect(mockCreateChallenge).toHaveBeenCalledWith({
      habitId: "h1",
      recipientId: "friend-123",
      milestoneType: "consistencyTarget",
      targetValue: 65,
      periodDays: 30,
      rewardDescription: "Go hiking at the park",
    });

    // Done button
    fireEvent.press(getByRole("button", { name: "Done, return to previous screen" }));
    expect(onComplete).toHaveBeenCalled();
  }, 15_000);

  // --- Happy path: pre-selected friend/habit context ---

  it("pre-selects habit when preSelectedHabitId is provided", async () => {
    const habits = [
      makeHabit({ id: "h1", name: "Meditate" }),
      makeHabit({ id: "h2", name: "Read" }),
    ];
    mockFetchFriendProfile.mockResolvedValue(makeProfile({ habits }));

    const { getByTestId, getByRole } = render(
      <CreateChallengeScreen
        friendId="friend-123"
        friendName="Alice"
        preSelectedHabitId="h2"
      />,
    );

    await waitFor(() => {
      expect(getByTestId("step-1-select-habit")).toBeTruthy();
    });

    // h2 should be pre-selected (radio checked)
    const h2Option = getByTestId("habit-option-h2");
    expect(h2Option.props.accessibilityState?.checked).toBe(true);

    // Continue should be enabled since habit is pre-selected
    const continueBtn = getByRole("button", { name: "Continue to next step" });
    expect(continueBtn.props.accessibilityState?.disabled).not.toBe(true);
  });

  // --- Happy path: auto-selects single habit ---

  it("auto-selects the habit when friend has only one", async () => {
    mockFetchFriendProfile.mockResolvedValue(makeProfile({
      habits: [makeHabit({ id: "h1", name: "Exercise" })],
    }));

    const { getByTestId, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    await waitFor(() => {
      expect(getByTestId("step-1-select-habit")).toBeTruthy();
    });

    // Should be able to continue immediately since auto-selected
    const continueBtn = getByRole("button", { name: "Continue to next step" });
    expect(continueBtn.props.accessibilityState?.disabled).not.toBe(true);
  });

  // --- Edge case: minimum/maximum consistency target validation ---

  it("clamps target value within valid range", async () => {
    mockFetchFriendProfile.mockResolvedValue(makeProfile());

    const { getByTestId, getByText, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    await waitFor(() => {
      expect(getByTestId("step-1-select-habit")).toBeTruthy();
    });

    // Select habit and go to step 2
    fireEvent.press(getByTestId("habit-option-habit-1"));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));

    await waitFor(() => {
      expect(getByTestId("step-2-set-target")).toBeTruthy();
    });

    // Decrease to minimum
    for (let i = 0; i < 30; i++) {
      fireEvent.press(getByTestId("target-decrease"));
    }
    expect(getByText("1%")).toBeTruthy();

    // Increase to maximum
    for (let i = 0; i < 30; i++) {
      fireEvent.press(getByTestId("target-increase"));
    }
    expect(getByText("100%")).toBeTruthy();
  });

  // --- Edge case: empty reward description blocked ---

  it("disables continue when reward description is empty", async () => {
    mockFetchFriendProfile.mockResolvedValue(makeProfile());

    const { getByTestId, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    await waitFor(() => {
      expect(getByTestId("step-1-select-habit")).toBeTruthy();
    });

    // Step 1 -> 2 -> 3
    fireEvent.press(getByTestId("habit-option-habit-1"));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-2-set-target")).toBeTruthy());
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-3-reward")).toBeTruthy());

    // Continue should be disabled with empty reward
    const continueBtn = getByRole("button", { name: "Continue to next step" });
    expect(continueBtn.props.accessibilityState?.disabled).toBe(true);
  });

  // --- Edge case: network timeout during create retains draft state ---

  it("retains draft state on network timeout during create", async () => {
    mockFetchFriendProfile.mockResolvedValue(makeProfile());
    const timeoutError: ApiError = { status: 0, code: "timeout", message: "The request timed out." };
    mockCreateChallenge.mockRejectedValue(timeoutError);

    const { getByTestId, getByText, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    // Navigate to step 4
    await waitFor(() => expect(getByTestId("step-1-select-habit")).toBeTruthy());
    fireEvent.press(getByTestId("habit-option-habit-1"));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-2-set-target")).toBeTruthy());
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-3-reward")).toBeTruthy());
    fireEvent.changeText(getByTestId("reward-input"), "Go hiking");
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-4-preview")).toBeTruthy());

    // Submit (fails)
    await act(async () => {
      fireEvent.press(getByRole("button", { name: "Send challenge" }));
    });

    // Should stay on step 4 with error, not lose the form
    expect(getByTestId("step-4-preview")).toBeTruthy();
    expect(getByTestId("submit-error")).toBeTruthy();
    expect(getByText("The request timed out.")).toBeTruthy();

    // Draft data still visible
    expect(getByText("Go hiking")).toBeTruthy();
  });

  // --- Error condition: POST /challenges returns 400 → show field-specific errors ---

  it("shows field-specific errors on 400 validation response", async () => {
    mockFetchFriendProfile.mockResolvedValue(makeProfile());
    const validationError: ApiError = {
      status: 400,
      code: "validation",
      message: "Please check your input.",
      validationErrors: { RewardDescription: ["RewardDescription is required"] },
    };
    mockCreateChallenge.mockRejectedValue(validationError);

    const { getByTestId, getByText, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    // Navigate to step 4
    await waitFor(() => expect(getByTestId("step-1-select-habit")).toBeTruthy());
    fireEvent.press(getByTestId("habit-option-habit-1"));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-2-set-target")).toBeTruthy());
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-3-reward")).toBeTruthy());
    fireEvent.changeText(getByTestId("reward-input"), "Test reward");
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-4-preview")).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByRole("button", { name: "Send challenge" }));
    });

    expect(getByTestId("submit-error")).toBeTruthy();
    expect(getByText("RewardDescription is required")).toBeTruthy();
  });

  // --- Error condition: POST /challenges returns 409 (duplicate active) ---

  it("explains existing challenge on 409 conflict", async () => {
    mockFetchFriendProfile.mockResolvedValue(makeProfile());
    const conflictError: ApiError = {
      status: 409,
      code: "conflict",
      message: "An active challenge already exists for this habit and recipient",
    };
    mockCreateChallenge.mockRejectedValue(conflictError);

    const { getByTestId, getByText, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    // Navigate to step 4
    await waitFor(() => expect(getByTestId("step-1-select-habit")).toBeTruthy());
    fireEvent.press(getByTestId("habit-option-habit-1"));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-2-set-target")).toBeTruthy());
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-3-reward")).toBeTruthy());
    fireEvent.changeText(getByTestId("reward-input"), "Test");
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-4-preview")).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByRole("button", { name: "Send challenge" }));
    });

    expect(getByTestId("submit-error")).toBeTruthy();
    expect(getByText(/already an active challenge/i)).toBeTruthy();
  });

  // --- Error condition: POST /challenges returns 503 (Social Service down) ---

  it("shows service unavailable on 503, not 'not friends'", async () => {
    mockFetchFriendProfile.mockResolvedValue(makeProfile());
    const serviceError: ApiError = {
      status: 503,
      code: "server_error",
      message: "Something went wrong on our end.",
    };
    mockCreateChallenge.mockRejectedValue(serviceError);

    const { getByTestId, getByText, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    // Navigate to step 4 and submit
    await waitFor(() => expect(getByTestId("step-1-select-habit")).toBeTruthy());
    fireEvent.press(getByTestId("habit-option-habit-1"));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-2-set-target")).toBeTruthy());
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-3-reward")).toBeTruthy());
    fireEvent.changeText(getByTestId("reward-input"), "Test");
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-4-preview")).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByRole("button", { name: "Send challenge" }));
    });

    expect(getByTestId("submit-error")).toBeTruthy();
    // Should say "temporarily unavailable", NOT "not friends"
    expect(getByText(/temporarily unavailable/i)).toBeTruthy();
  });

  // --- Loading state ---

  it("shows loading state while fetching habits", () => {
    mockFetchFriendProfile.mockReturnValue(new Promise(() => {}));

    const { getByTestId } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    expect(getByTestId("create-challenge-loading")).toBeTruthy();
  });

  // --- Load error with retry ---

  it("shows error state with retry on habit fetch failure", async () => {
    const apiError: ApiError = { status: 500, code: "server_error", message: "Failed to load" };
    mockFetchFriendProfile.mockRejectedValue(apiError);

    const { getByTestId, getByText } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    await waitFor(() => {
      expect(getByTestId("create-challenge-error")).toBeTruthy();
    });
    expect(getByText("Failed to load")).toBeTruthy();

    // Retry
    mockFetchFriendProfile.mockResolvedValue(makeProfile());
    await act(async () => {
      fireEvent.press(getByText("Try again"));
    });

    await waitFor(() => {
      expect(getByTestId("create-challenge-screen")).toBeTruthy();
    });
  });

  // --- No habits available ---

  it("shows empty state when friend has no shared habits", async () => {
    mockFetchFriendProfile.mockResolvedValue(makeProfile({ habits: [] }));

    const { getByTestId, getByText } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    await waitFor(() => {
      expect(getByTestId("no-habits-available")).toBeTruthy();
    });
    expect(getByText(/hasn't shared any habits yet/)).toBeTruthy();
  });

  // --- Back navigation from step 1 calls onBack ---

  it("calls onBack when pressing back from step 1", async () => {
    const onBack = jest.fn();

    const { getByTestId } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" onBack={onBack} />,
    );

    await waitFor(() => {
      expect(getByTestId("step-1-select-habit")).toBeTruthy();
    });

    fireEvent.press(getByTestId("back-button"));
    expect(onBack).toHaveBeenCalled();
  });

  // --- Back navigation from step 2 goes to step 1 ---

  it("goes back from step 2 to step 1", async () => {
    const { getByTestId, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    await waitFor(() => expect(getByTestId("step-1-select-habit")).toBeTruthy());
    fireEvent.press(getByTestId("habit-option-habit-1"));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-2-set-target")).toBeTruthy());

    fireEvent.press(getByTestId("back-button"));
    await waitFor(() => expect(getByTestId("step-1-select-habit")).toBeTruthy());
  });

  // --- Period preset selection ---

  it("allows selecting period presets", async () => {
    const { getByTestId, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    await waitFor(() => expect(getByTestId("step-1-select-habit")).toBeTruthy());
    fireEvent.press(getByTestId("habit-option-habit-1"));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-2-set-target")).toBeTruthy());

    // Select 90 days preset
    fireEvent.press(getByTestId("period-90"));
    // The chip should be selectable (we verify it doesn't crash)
    expect(getByTestId("period-90")).toBeTruthy();
  });

  // --- Reward example suggestions ---

  it("fills reward from suggestion tap", async () => {
    const { getByTestId, getByText, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    await waitFor(() => expect(getByTestId("step-1-select-habit")).toBeTruthy());
    fireEvent.press(getByTestId("habit-option-habit-1"));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-2-set-target")).toBeTruthy());
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-3-reward")).toBeTruthy());

    // Tap a suggestion
    fireEvent.press(getByText("Play a round of tennis together"));

    // Continue should now be enabled (reward is non-empty)
    const continueBtn = getByRole("button", { name: "Continue to next step" });
    expect(continueBtn.props.accessibilityState?.disabled).not.toBe(true);
  });

  // --- Step indicator shows correct step ---

  it("shows correct step indicator", async () => {
    const { getByTestId, getByRole } = render(
      <CreateChallengeScreen friendId="friend-123" friendName="Alice" />,
    );

    await waitFor(() => expect(getByTestId("step-1-select-habit")).toBeTruthy());
    expect(getByTestId("step-indicator").props.children.join("")).toContain("1");

    fireEvent.press(getByTestId("habit-option-habit-1"));
    fireEvent.press(getByRole("button", { name: "Continue to next step" }));
    await waitFor(() => expect(getByTestId("step-2-set-target")).toBeTruthy());
    expect(getByTestId("step-indicator").props.children.join("")).toContain("2");
  });
});
