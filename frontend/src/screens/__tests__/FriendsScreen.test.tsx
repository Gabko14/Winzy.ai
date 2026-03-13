import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { Alert } from "react-native";
import { FriendsScreen } from "../FriendsScreen";
import type { Friend, IncomingRequest, OutgoingRequest } from "../../api/social";

// Mock the useFriends hook
const mockUseFriends = {
  friends: [] as Friend[],
  totalFriends: 0,
  incoming: [] as IncomingRequest[],
  outgoing: [] as OutgoingRequest[],
  loading: false,
  requestsLoading: false,
  error: null as null | { status: number; code: string; message: string },
  requestsError: null as null | { status: number; code: string; message: string },
  refresh: jest.fn(),
  acceptRequest: jest.fn().mockResolvedValue(true),
  declineRequest: jest.fn().mockResolvedValue(true),
  cancelRequest: jest.fn().mockResolvedValue(true),
  removeFriend: jest.fn().mockResolvedValue(true),
};

jest.mock("../../hooks/useFriends", () => ({
  useFriends: () => mockUseFriends,
}));

jest.spyOn(Alert, "alert");

function makeFriend(overrides: Partial<Friend> = {}): Friend {
  const id = overrides.friendId ?? Math.random().toString(36).slice(2);
  return {
    friendId: id,
    since: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

function makeIncomingRequest(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    id: Math.random().toString(36).slice(2),
    fromUserId: "user-abc",
    direction: "incoming",
    createdAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function makeOutgoingRequest(overrides: Partial<OutgoingRequest> = {}): OutgoingRequest {
  return {
    id: Math.random().toString(36).slice(2),
    toUserId: "user-xyz",
    direction: "outgoing",
    createdAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseFriends.friends = [];
  mockUseFriends.totalFriends = 0;
  mockUseFriends.incoming = [];
  mockUseFriends.outgoing = [];
  mockUseFriends.loading = false;
  mockUseFriends.requestsLoading = false;
  mockUseFriends.error = null;
  mockUseFriends.requestsError = null;
});

describe("FriendsScreen", () => {
  // --- Happy path: renders friend list ---

  it("renders friend list with friend items", () => {
    const friends = [makeFriend({ friendId: "friend-1" }), makeFriend({ friendId: "friend-2" })];
    mockUseFriends.friends = friends;
    mockUseFriends.totalFriends = 2;

    const { getByTestId } = render(<FriendsScreen />);

    expect(getByTestId("friends-screen")).toBeTruthy();
    expect(getByTestId("friend-friend-1")).toBeTruthy();
    expect(getByTestId("friend-friend-2")).toBeTruthy();
  });

  // --- Happy path: renders pending requests with accept/decline ---

  it("renders pending requests section with accept/decline buttons", () => {
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    const incoming = makeIncomingRequest({ id: "req-1" });
    mockUseFriends.incoming = [incoming];

    const { getByTestId, getAllByText } = render(<FriendsScreen />);

    expect(getByTestId("pending-requests-section")).toBeTruthy();
    expect(getAllByText("Accept").length).toBeGreaterThan(0);
    expect(getAllByText("Decline").length).toBeGreaterThan(0);
  });

  it("calls acceptRequest when Accept is pressed", async () => {
    const incoming = makeIncomingRequest({ id: "req-accept" });
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    mockUseFriends.incoming = [incoming];

    const { getAllByText } = render(<FriendsScreen />);

    await act(async () => {
      fireEvent.press(getAllByText("Accept")[0]);
    });

    expect(mockUseFriends.acceptRequest).toHaveBeenCalledWith("req-accept");
  });

  it("calls declineRequest when Decline is pressed", async () => {
    const incoming = makeIncomingRequest({ id: "req-decline" });
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    mockUseFriends.incoming = [incoming];

    const { getAllByText } = render(<FriendsScreen />);

    await act(async () => {
      fireEvent.press(getAllByText("Decline")[0]);
    });

    expect(mockUseFriends.declineRequest).toHaveBeenCalledWith("req-decline");
  });

  // --- Edge case: empty state when no friends and no pending requests ---

  it("shows empty state when no friends and no pending requests", () => {
    const onAddFriend = jest.fn();
    const { getByTestId, getByText } = render(<FriendsScreen onAddFriend={onAddFriend} />);

    expect(getByTestId("friends-empty")).toBeTruthy();
    expect(getByText("Add friends to share your journey")).toBeTruthy();

    fireEvent.press(getByText("Find friends"));
    expect(onAddFriend).toHaveBeenCalled();
  });

  // --- Edge case: friends with no public habits (shows friend but no flames) ---

  it("renders friend item even without flame data", () => {
    // Friend object has no habit/flame data — just friendId and since
    mockUseFriends.friends = [makeFriend({ friendId: "no-habits-friend" })];
    mockUseFriends.totalFriends = 1;

    const { getByTestId } = render(<FriendsScreen />);

    expect(getByTestId("friend-no-habits-friend")).toBeTruthy();
  });

  // --- Edge case: friend with displayName shows name instead of UUID ---

  it("shows displayName and username when available on friend", () => {
    mockUseFriends.friends = [
      makeFriend({ friendId: "enriched-id", displayName: "Alice Smith", username: "alice" }),
    ];
    mockUseFriends.totalFriends = 1;

    const { getByText } = render(<FriendsScreen />);

    expect(getByText("Alice Smith")).toBeTruthy();
    expect(getByText("@alice")).toBeTruthy();
  });

  // --- Edge case: friend without profile data shows truncated ID ---

  it("shows truncated friendId when no profile data available", () => {
    mockUseFriends.friends = [
      makeFriend({ friendId: "abcd1234-5678-9012-3456-789012345678" }),
    ];
    mockUseFriends.totalFriends = 1;

    const { getByText } = render(<FriendsScreen />);

    expect(getByText("User abcd1234")).toBeTruthy();
  });

  // --- Error condition: API failure renders ErrorState with retry ---

  it("shows error state with retry when API fails", () => {
    mockUseFriends.error = {
      status: 500,
      code: "server_error",
      message: "Something went wrong on our end. Please try again.",
    };

    const { getByTestId, getByText } = render(<FriendsScreen />);

    expect(getByTestId("friends-error")).toBeTruthy();
    expect(getByText("Something went wrong on our end. Please try again.")).toBeTruthy();

    fireEvent.press(getByText("Try again"));
    expect(mockUseFriends.refresh).toHaveBeenCalled();
  });

  // --- Error condition: partial load (friends succeed, pending requests fail) ---

  it("shows friends list and requests error when requests fail but friends succeed", () => {
    mockUseFriends.friends = [makeFriend({ friendId: "partial-friend" })];
    mockUseFriends.totalFriends = 1;
    mockUseFriends.requestsError = {
      status: 500,
      code: "server_error",
      message: "Could not load friend requests",
    };

    const { getByTestId } = render(<FriendsScreen />);

    // Friends list renders fine
    expect(getByTestId("friends-screen")).toBeTruthy();
    expect(getByTestId("friend-partial-friend")).toBeTruthy();
  });

  // --- Loading state ---

  it("shows loading state on initial load", () => {
    mockUseFriends.loading = true;
    mockUseFriends.requestsLoading = true;

    const { getByTestId } = render(<FriendsScreen />);
    expect(getByTestId("friends-loading")).toBeTruthy();
  });

  // --- Remove friend via long press + alert ---

  it("shows confirmation dialog on long press and calls removeFriend", async () => {
    const friend = makeFriend({ friendId: "remove-me" });
    mockUseFriends.friends = [friend];
    mockUseFriends.totalFriends = 1;

    const { getByTestId } = render(<FriendsScreen />);
    fireEvent(getByTestId("friend-remove-me"), "longPress");

    expect(Alert.alert).toHaveBeenCalledWith(
      "Remove friend",
      "Are you sure you want to remove this friend?",
      expect.arrayContaining([
        expect.objectContaining({ text: "Cancel" }),
        expect.objectContaining({ text: "Remove", style: "destructive" }),
      ]),
    );

    // Simulate pressing "Remove" in the alert
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const buttons = alertCalls[0][2];
    const removeButton = buttons.find((b: { text: string }) => b.text === "Remove");

    await act(async () => {
      removeButton.onPress();
    });

    expect(mockUseFriends.removeFriend).toHaveBeenCalledWith("remove-me");
  });

  // --- Add friend button ---

  it("calls onAddFriend when add button is pressed", () => {
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    const onAddFriend = jest.fn();

    const { getByTestId } = render(<FriendsScreen onAddFriend={onAddFriend} />);
    fireEvent.press(getByTestId("add-friend-button"));
    expect(onAddFriend).toHaveBeenCalled();
  });

  // --- Outgoing request with cancel ---

  it("renders outgoing request with cancel option", async () => {
    const outgoing = makeOutgoingRequest({ id: "out-1" });
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    mockUseFriends.outgoing = [outgoing];

    const { getByTestId, getByText } = render(<FriendsScreen />);

    expect(getByTestId("pending-requests-section")).toBeTruthy();
    expect(getByText("Cancel")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText("Cancel"));
    });

    expect(mockUseFriends.cancelRequest).toHaveBeenCalledWith("out-1");
  });

  // --- Friend press navigation ---

  it("calls onFriendPress when friend is tapped", () => {
    mockUseFriends.friends = [makeFriend({ friendId: "tap-me" })];
    mockUseFriends.totalFriends = 1;
    const onFriendPress = jest.fn();

    const { getByTestId } = render(<FriendsScreen onFriendPress={onFriendPress} />);
    fireEvent.press(getByTestId("friend-tap-me"));
    expect(onFriendPress).toHaveBeenCalledWith("tap-me");
  });
});
