import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { FriendProfileScreen } from "../FriendProfileScreen";
import type { FriendProfileResponse, FriendHabit } from "../../api/social";

// Mock the fetchFriendProfile API call
const mockFetchFriendProfile = jest.fn<Promise<FriendProfileResponse>, [string]>();

jest.mock("../../api/social", () => ({
  ...jest.requireActual("../../api/social"),
  fetchFriendProfile: (...args: [string]) => mockFetchFriendProfile(...args),
}));

function makeHabit(overrides: Partial<FriendHabit> = {}): FriendHabit {
  return {
    id: Math.random().toString(36).slice(2),
    name: "Exercise",
    icon: null,
    color: null,
    consistency: 65,
    flameLevel: "strong",
    ...overrides,
  };
}

function makeProfileResponse(overrides: Partial<FriendProfileResponse> = {}): FriendProfileResponse {
  return {
    friendId: "friend-123",
    habits: [makeHabit()],
    habitsUnavailable: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchFriendProfile.mockResolvedValue(makeProfileResponse());
});

describe("FriendProfileScreen", () => {
  // --- Happy path: renders friend profile header (name, avatar, member-since) ---

  it("renders friend profile header with name, avatar, and member-since", async () => {
    const { getByTestId, getAllByText, getByText } = render(
      <FriendProfileScreen
        friendId="friend-123"
        displayName="Alice Smith"
        username="alice"
        since="2026-01-15T00:00:00Z"
      />,
    );

    await waitFor(() => {
      expect(getByTestId("friend-profile-screen")).toBeTruthy();
    });

    expect(getByTestId("friend-profile-header")).toBeTruthy();
    // Name appears in both the header bar and the profile section
    expect(getAllByText("Alice Smith").length).toBeGreaterThanOrEqual(1);
    expect(getByText("@alice")).toBeTruthy();
    expect(getByTestId("member-since")).toBeTruthy();
  });

  // --- Happy path: renders visible habits with flame indicators ---

  it("renders visible habits with flame indicators sized for profile view", async () => {
    const habits = [
      makeHabit({ id: "h1", name: "Meditate", consistency: 80, flameLevel: "blazing" }),
      makeHabit({ id: "h2", name: "Read", consistency: 30, flameLevel: "steady" }),
    ];
    mockFetchFriendProfile.mockResolvedValue(makeProfileResponse({ habits }));

    const { getByTestId, getByText } = render(
      <FriendProfileScreen friendId="friend-123" displayName="Alice Smith" />,
    );

    await waitFor(() => {
      expect(getByTestId("habits-section")).toBeTruthy();
    });

    expect(getByTestId("habit-h1")).toBeTruthy();
    expect(getByTestId("habit-h2")).toBeTruthy();
    expect(getByText("Meditate")).toBeTruthy();
    expect(getByText("Read")).toBeTruthy();
    expect(getByText("80% consistency")).toBeTruthy();
    expect(getByText("30% consistency")).toBeTruthy();
    // Aggregate flame should be visible
    expect(getByTestId("aggregate-flame")).toBeTruthy();
  });

  // --- Happy path: Set Challenge button visible and navigates ---

  it("renders Set Challenge button that calls onSetChallenge", async () => {
    const onSetChallenge = jest.fn();
    const { getByTestId, getByRole } = render(
      <FriendProfileScreen
        friendId="friend-123"
        displayName="Alice Smith"
        onSetChallenge={onSetChallenge}
      />,
    );

    await waitFor(() => {
      expect(getByTestId("friend-profile-screen")).toBeTruthy();
    });

    // The testID is on the wrapping View; find the actual button by accessibility
    expect(getByTestId("set-challenge-button")).toBeTruthy();
    const button = getByRole("button", { name: "Set challenge for this friend" });
    fireEvent.press(button);
    expect(onSetChallenge).toHaveBeenCalledWith("friend-123", "Alice Smith");
  });

  // --- Edge case: friend with no visible habits shows encouraging empty state ---

  it("shows encouraging empty state when friend has no visible habits", async () => {
    mockFetchFriendProfile.mockResolvedValue(makeProfileResponse({ habits: [] }));

    const { getByTestId, getByText } = render(
      <FriendProfileScreen friendId="friend-123" displayName="Bob" />,
    );

    await waitFor(() => {
      expect(getByTestId("no-habits-empty")).toBeTruthy();
    });

    expect(getByText("No shared habits")).toBeTruthy();
    expect(
      getByText("Bob hasn't shared any habits with you yet. When they do, you'll see their flames here."),
    ).toBeTruthy();
  });

  // --- Edge case: friend with all habits private shows "No shared habits" ---

  it("shows No shared habits when all habits are private", async () => {
    // Backend filters private habits, so response comes back with empty array
    mockFetchFriendProfile.mockResolvedValue(makeProfileResponse({ habits: [] }));

    const { getByTestId, getByText } = render(
      <FriendProfileScreen friendId="friend-456" displayName="Charlie" />,
    );

    await waitFor(() => {
      expect(getByTestId("no-habits-empty")).toBeTruthy();
    });

    expect(getByText("No shared habits")).toBeTruthy();
  });

  // --- Error condition: profile fetch failure renders ErrorState with retry ---

  it("renders ErrorState with retry on profile fetch failure", async () => {
    const apiError = { status: 500, code: "server_error" as const, message: "Could not load profile. Please try again." };
    mockFetchFriendProfile.mockRejectedValue(apiError);

    const { getByTestId, getByText } = render(
      <FriendProfileScreen friendId="friend-123" displayName="Alice" />,
    );

    await waitFor(() => {
      expect(getByTestId("friend-profile-error")).toBeTruthy();
    });

    expect(getByText("Could not load profile. Please try again.")).toBeTruthy();

    // Retry should re-fetch
    mockFetchFriendProfile.mockResolvedValue(makeProfileResponse());
    await act(async () => {
      fireEvent.press(getByText("Try again"));
    });

    await waitFor(() => {
      expect(getByTestId("friend-profile-screen")).toBeTruthy();
    });
  });

  // --- Error condition: upstream habit-service failure shows degraded state ---

  it("shows degraded state when habitsUnavailable is true", async () => {
    mockFetchFriendProfile.mockResolvedValue(
      makeProfileResponse({ habits: [], habitsUnavailable: true }),
    );

    const { getByTestId, getByText, queryByTestId } = render(
      <FriendProfileScreen friendId="friend-123" displayName="Diana" />,
    );

    await waitFor(() => {
      expect(getByTestId("friend-profile-screen")).toBeTruthy();
    });

    // Should show degraded banner, NOT the misleading "No shared habits"
    expect(getByTestId("habits-degraded")).toBeTruthy();
    expect(getByText("Couldn't load habits")).toBeTruthy();
    expect(getByText("Habit data is temporarily unavailable. Try again in a moment.")).toBeTruthy();
    expect(queryByTestId("no-habits-empty")).toBeNull();

    // Retry button should trigger a re-fetch
    mockFetchFriendProfile.mockResolvedValue(makeProfileResponse());
    await act(async () => {
      fireEvent.press(getByText("Try again"));
    });

    await waitFor(() => {
      expect(getByTestId("habits-section")).toBeTruthy();
    });
  });

  it("shows genuine empty state when habits are empty but available", async () => {
    mockFetchFriendProfile.mockResolvedValue(
      makeProfileResponse({ habits: [], habitsUnavailable: false }),
    );

    const { getByTestId, getByText, queryByTestId } = render(
      <FriendProfileScreen friendId="friend-123" displayName="Diana" />,
    );

    await waitFor(() => {
      expect(getByTestId("friend-profile-screen")).toBeTruthy();
    });

    // Should show genuine empty state
    expect(getByTestId("no-habits-empty")).toBeTruthy();
    expect(getByText("No shared habits")).toBeTruthy();
    expect(queryByTestId("habits-degraded")).toBeNull();
  });

  // --- Back navigation ---

  it("calls onBack when back button is pressed", async () => {
    const onBack = jest.fn();
    const { getByTestId } = render(
      <FriendProfileScreen friendId="friend-123" displayName="Alice" onBack={onBack} />,
    );

    await waitFor(() => {
      expect(getByTestId("friend-profile-screen")).toBeTruthy();
    });

    fireEvent.press(getByTestId("back-button"));
    expect(onBack).toHaveBeenCalled();
  });

  // --- Fallback display when no profile data ---

  it("shows truncated friendId when no displayName or username", async () => {
    const { getByText } = render(
      <FriendProfileScreen friendId="abcd1234-5678" />,
    );

    await waitFor(() => {
      expect(getByText("User abcd1234")).toBeTruthy();
    });
  });

  // --- Loading state ---

  it("shows loading state while profile is being fetched", () => {
    // Never resolve the promise so it stays loading
    mockFetchFriendProfile.mockReturnValue(new Promise(() => {}));

    const { getByTestId } = render(
      <FriendProfileScreen friendId="friend-123" displayName="Alice" />,
    );

    expect(getByTestId("friend-profile-loading")).toBeTruthy();
  });
});
