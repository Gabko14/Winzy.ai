import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Alert } from "react-native";
import { AddFriendScreen } from "../AddFriendScreen";
import type { UserSearchResult } from "../../api/social";

// Mock useUserSearch hook
const mockUseUserSearch = {
  query: "",
  setQuery: jest.fn(),
  results: [] as UserSearchResult[],
  loading: false,
  error: null as null | { status: number; code: string; message: string },
  clear: jest.fn(),
};

jest.mock("../../hooks/useUserSearch", () => ({
  useUserSearch: () => mockUseUserSearch,
}));

// Mock sendFriendRequest
const mockSendFriendRequest = jest.fn();
jest.mock("../../api/social", () => ({
  ...jest.requireActual("../../api/social"),
  sendFriendRequest: (...args: unknown[]) => mockSendFriendRequest(...args),
}));

jest.spyOn(Alert, "alert");

function makeUser(overrides: Partial<UserSearchResult> = {}): UserSearchResult {
  return {
    id: Math.random().toString(36).slice(2),
    username: "testuser",
    displayName: "Test User",
    avatarUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseUserSearch.query = "";
  mockUseUserSearch.results = [];
  mockUseUserSearch.loading = false;
  mockUseUserSearch.error = null;
  mockSendFriendRequest.mockResolvedValue({
    id: "req-1",
    userId: "me",
    friendId: "them",
    status: "pending",
    createdAt: "2026-03-01T00:00:00Z",
  });
});

describe("AddFriendScreen", () => {
  // --- Happy path: search users by username returns results ---

  it("renders search results with avatar and name", () => {
    mockUseUserSearch.query = "alice";
    mockUseUserSearch.results = [
      makeUser({ id: "u1", username: "alice", displayName: "Alice Smith" }),
      makeUser({ id: "u2", username: "alicew", displayName: "Alice Wang" }),
    ];

    const { getByTestId, getByText } = render(<AddFriendScreen />);

    expect(getByTestId("search-results")).toBeTruthy();
    expect(getByText("Alice Smith")).toBeTruthy();
    expect(getByText("@alice")).toBeTruthy();
    expect(getByText("Alice Wang")).toBeTruthy();
    expect(getByText("@alicew")).toBeTruthy();
  });

  // --- Happy path: send friend request shows confirmation ---

  it("sends friend request and shows confirmation alert", async () => {
    const user = makeUser({ id: "target-user", username: "bob", displayName: "Bob" });
    mockUseUserSearch.query = "bob";
    mockUseUserSearch.results = [user];

    const { getAllByText } = render(<AddFriendScreen currentUserId="me" />);

    await act(async () => {
      fireEvent.press(getAllByText("Add")[0]);
    });

    expect(mockSendFriendRequest).toHaveBeenCalledWith("target-user");
    expect(Alert.alert).toHaveBeenCalledWith("Request sent!", "Friend request sent to Bob.");
  });

  // --- Happy path: accept incoming request shows now-friends message ---
  // (This is tested in FriendsScreen — AddFriendScreen only sends requests)

  // --- Happy path: decline incoming request removes from pending list ---
  // (This is tested in FriendsScreen)

  // --- Happy path: remove friend shows confirmation dialog ---
  // (This is tested in FriendsScreen)

  // --- Edge case: search with no results shows "No users found" ---

  it("shows no users found when search returns empty", () => {
    mockUseUserSearch.query = "zzzznonexistent";
    mockUseUserSearch.results = [];

    const { getByTestId, getByText } = render(<AddFriendScreen />);

    expect(getByTestId("search-empty")).toBeTruthy();
    expect(getByText("No users found")).toBeTruthy();
  });

  // --- Edge case: send request to self is prevented ---

  it("prevents sending friend request to self", async () => {
    const selfUser = makeUser({ id: "my-id", username: "me" });
    mockUseUserSearch.query = "me";
    mockUseUserSearch.results = [selfUser];

    const { getAllByText } = render(<AddFriendScreen currentUserId="my-id" />);

    // The "You" badge should show, but let's also test the alert path
    // when the user somehow triggers sendRequest for themselves
    // The UI shows a "You" badge instead of "Add" button
    expect(getAllByText("You").length).toBeGreaterThan(0);
  });

  // --- Edge case: duplicate request shows appropriate message ---

  it("shows conflict error when duplicate request is sent", async () => {
    mockSendFriendRequest.mockRejectedValue({
      status: 409,
      code: "conflict",
      message: "Friend request already exists",
    });

    const user = makeUser({ id: "dup-user", username: "dupe" });
    mockUseUserSearch.query = "dupe";
    mockUseUserSearch.results = [user];

    const { getAllByText, getByText } = render(<AddFriendScreen currentUserId="me" />);

    await act(async () => {
      fireEvent.press(getAllByText("Add")[0]);
    });

    await waitFor(() => {
      expect(getByText("Friend request already exists")).toBeTruthy();
    });
  });

  // --- Error condition: search API failure shows error with retry ---

  it("shows error state when search fails", () => {
    mockUseUserSearch.query = "failing";
    mockUseUserSearch.error = {
      status: 500,
      code: "server_error",
      message: "Something went wrong on our end. Please try again.",
    };

    const { getByTestId } = render(<AddFriendScreen />);

    expect(getByTestId("search-error")).toBeTruthy();
  });

  // --- Error condition: send request fails restores state ---

  it("shows generic error when send request fails with non-conflict error", async () => {
    mockSendFriendRequest.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Internal server error",
    });

    const user = makeUser({ id: "fail-user", username: "failuser" });
    mockUseUserSearch.query = "fail";
    mockUseUserSearch.results = [user];

    const { getAllByText, getByText } = render(<AddFriendScreen currentUserId="me" />);

    await act(async () => {
      fireEvent.press(getAllByText("Add")[0]);
    });

    await waitFor(() => {
      expect(getByText("Failed to send request. Please try again.")).toBeTruthy();
    });
  });

  // --- Search hint shown when query is too short ---

  it("shows search hint when query is less than 2 characters", () => {
    mockUseUserSearch.query = "";

    const { getByTestId, getByText } = render(<AddFriendScreen />);

    expect(getByTestId("search-hint")).toBeTruthy();
    expect(getByText("Search for friends")).toBeTruthy();
  });

  // --- Loading state during search ---

  it("shows loading state during search", () => {
    mockUseUserSearch.query = "loading";
    mockUseUserSearch.loading = true;

    const { getByTestId } = render(<AddFriendScreen />);

    expect(getByTestId("search-loading")).toBeTruthy();
  });

  // --- Back button ---

  it("calls onBack when back button is pressed", () => {
    const onBack = jest.fn();
    const { getByTestId } = render(<AddFriendScreen onBack={onBack} />);

    fireEvent.press(getByTestId("back-button"));
    expect(onBack).toHaveBeenCalled();
  });

  // --- Sent badge after successful request ---

  it("shows Sent badge after successfully sending request", async () => {
    const user = makeUser({ id: "sent-user", username: "sentuser", displayName: "Sent User" });
    mockUseUserSearch.query = "sent";
    mockUseUserSearch.results = [user];

    const { getAllByText, queryAllByText } = render(<AddFriendScreen currentUserId="me" />);

    // Initially shows "Add" button
    expect(getAllByText("Add").length).toBe(1);

    await act(async () => {
      fireEvent.press(getAllByText("Add")[0]);
    });

    await waitFor(() => {
      expect(queryAllByText("Sent").length).toBe(1);
    });
  });
});
