import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { FeedScreen } from "../FeedScreen";
import type { FeedEntry, FeedEventType } from "../../api/feed";
import type { Friend } from "../../api/social";

// Mock the useFeed hook
const mockUseFeed = {
  items: [] as FeedEntry[],
  hasMore: false,
  loading: false,
  loadingMore: false,
  error: null as null | { status: number; code: string; message: string },
  refresh: jest.fn(),
  loadMore: jest.fn(),
};

jest.mock("../../hooks/useFeed", () => ({
  useFeed: () => mockUseFeed,
}));

// Mock the useFriends hook
const mockUseFriends = {
  friends: [] as Friend[],
  totalFriends: 0,
  incoming: [],
  outgoing: [],
  loading: false,
  requestsLoading: false,
  error: null,
  requestsError: null,
  refresh: jest.fn(),
  acceptRequest: jest.fn(),
  declineRequest: jest.fn(),
  cancelRequest: jest.fn(),
  removeFriend: jest.fn(),
};

jest.mock("../../hooks/useFriends", () => ({
  useFriends: () => mockUseFriends,
}));

function makeEntry(overrides: Partial<FeedEntry> = {}): FeedEntry {
  const id = overrides.id ?? Math.random().toString(36).slice(2);
  return {
    id,
    actorId: "actor-001",
    eventType: "habit.completed" as FeedEventType,
    data: { userId: "actor-001", habitId: "habit-001", date: "2026-03-14", consistency: 0.85 },
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    ...overrides,
  };
}

function makeFriend(overrides: Partial<Friend> = {}): Friend {
  return {
    friendId: overrides.friendId ?? Math.random().toString(36).slice(2),
    since: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseFeed.items = [];
  mockUseFeed.hasMore = false;
  mockUseFeed.loading = false;
  mockUseFeed.loadingMore = false;
  mockUseFeed.error = null;
  mockUseFriends.friends = [];
  mockUseFriends.totalFriends = 0;
  mockUseFriends.loading = false;
});

describe("FeedScreen", () => {
  // --- Happy path: feed renders scrollable list ---

  it("renders scrollable list of activity entries with avatars, text, timestamps", () => {
    mockUseFriends.friends = [makeFriend({ friendId: "friend-1" })];
    mockUseFriends.totalFriends = 1;
    mockUseFeed.items = [
      makeEntry({ id: "e1", actorId: "actor-001", eventType: "habit.completed" }),
      makeEntry({ id: "e2", actorId: "actor-002", eventType: "friend.request.accepted" }),
      makeEntry({
        id: "e3",
        actorId: "actor-003",
        eventType: "challenge.completed",
        data: { challengeId: "ch-1", userId: "actor-003", reward: "Coffee together" },
      }),
    ];

    const { getByTestId, getByText } = render(<FeedScreen />);

    expect(getByTestId("feed-screen")).toBeTruthy();
    expect(getByTestId("feed-list")).toBeTruthy();
    expect(getByTestId("feed-entry-e1")).toBeTruthy();
    expect(getByTestId("feed-entry-e2")).toBeTruthy();
    expect(getByTestId("feed-entry-e3")).toBeTruthy();

    // Avatars present
    expect(getByTestId("feed-avatar-e1")).toBeTruthy();
    expect(getByTestId("feed-avatar-e2")).toBeTruthy();

    // Event labels
    expect(getByText(/completed a habit/)).toBeTruthy();
    expect(getByText(/became friends with someone/)).toBeTruthy();
    expect(getByText(/completed a challenge: Coffee together/)).toBeTruthy();
  });

  // --- Happy path: tapping avatar navigates to friend profile ---

  it("calls onAvatarPress when avatar is tapped", () => {
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    mockUseFeed.items = [makeEntry({ id: "e1", actorId: "actor-abc" })];

    const onAvatarPress = jest.fn();
    const { getByTestId } = render(<FeedScreen onAvatarPress={onAvatarPress} />);

    fireEvent.press(getByTestId("feed-avatar-e1"));
    expect(onAvatarPress).toHaveBeenCalledWith("actor-abc");
  });

  // --- Happy path: challenge entries navigate to challenge surfaces ---

  it("calls onChallengePress for challenge-related entries", () => {
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    mockUseFeed.items = [
      makeEntry({
        id: "e1",
        eventType: "challenge.created",
        data: { challengeId: "ch-99", fromUserId: "a", toUserId: "b", habitId: "h" },
      }),
    ];

    const onChallengePress = jest.fn();
    const { getByTestId } = render(<FeedScreen onChallengePress={onChallengePress} />);

    fireEvent.press(getByTestId("feed-entry-e1"));
    expect(onChallengePress).toHaveBeenCalledWith("ch-99");
  });

  // --- Happy path: pull-to-refresh reloads feed ---

  it("calls refresh on pull-to-refresh", () => {
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    mockUseFeed.items = [makeEntry({ id: "e1" })];

    const { getByTestId } = render(<FeedScreen />);
    const flatList = getByTestId("feed-list");

    // Simulate pull-to-refresh
    const refreshControl = flatList.props.refreshControl;
    act(() => {
      refreshControl.props.onRefresh();
    });

    expect(mockUseFeed.refresh).toHaveBeenCalled();
  });

  // --- Edge case: empty state for no friends ---

  it("shows 'Add friends to see activity' when user has no friends", () => {
    mockUseFriends.friends = [];
    mockUseFriends.totalFriends = 0;
    mockUseFriends.loading = false;
    mockUseFeed.items = [];
    mockUseFeed.loading = false;

    const { getByTestId, getByText } = render(<FeedScreen />);

    expect(getByTestId("feed-empty-no-friends")).toBeTruthy();
    expect(getByText("Add friends to see activity")).toBeTruthy();
  });

  // --- Edge case: empty state for quiet feed ---

  it("shows 'No recent activity' when user has friends but quiet feed", () => {
    mockUseFriends.friends = [makeFriend({ friendId: "friend-1" })];
    mockUseFriends.totalFriends = 1;
    mockUseFriends.loading = false;
    mockUseFeed.items = [];
    mockUseFeed.loading = false;

    const { getByTestId, getByText } = render(<FeedScreen />);

    expect(getByTestId("feed-empty-quiet")).toBeTruthy();
    expect(getByText("No recent activity")).toBeTruthy();
  });

  // --- Edge case: pagination loads more entries on scroll ---

  it("calls loadMore when end of list is reached", () => {
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    mockUseFeed.items = Array.from({ length: 20 }, (_, i) => makeEntry({ id: `e${i}` }));
    mockUseFeed.hasMore = true;

    const { getByTestId } = render(<FeedScreen />);
    const flatList = getByTestId("feed-list");

    act(() => {
      flatList.props.onEndReached();
    });

    expect(mockUseFeed.loadMore).toHaveBeenCalled();
  });

  // --- Edge case: feed entry for deleted habit/challenge renders gracefully ---

  it("renders gracefully when feed entry has null data", () => {
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    mockUseFeed.items = [
      makeEntry({ id: "e1", eventType: "habit.completed", data: null }),
      makeEntry({ id: "e2", eventType: "challenge.completed", data: null }),
    ];

    const { getByTestId, getByText } = render(<FeedScreen />);

    expect(getByTestId("feed-entry-e1")).toBeTruthy();
    expect(getByTestId("feed-entry-e2")).toBeTruthy();
    // Should not crash; should show generic labels
    expect(getByText(/completed a habit/)).toBeTruthy();
    expect(getByText(/completed a challenge/)).toBeTruthy();
  });

  // --- Error condition: GET /feed failure renders ErrorState with retry ---

  it("renders ErrorState with retry when feed fails to load", () => {
    mockUseFeed.error = { status: 500, code: "server_error", message: "Something went wrong on our end. Please try again." };
    mockUseFeed.items = [];
    mockUseFeed.loading = false;

    const { getByTestId, getByText } = render(<FeedScreen />);

    expect(getByTestId("feed-error")).toBeTruthy();
    expect(getByText("Something went wrong on our end. Please try again.")).toBeTruthy();

    // Retry button works
    fireEvent.press(getByText("Try again"));
    expect(mockUseFeed.refresh).toHaveBeenCalled();
  });

  // --- Error condition: Social Service down returns empty feed ---

  it("shows empty feed (not crash) when social service is down and feed is empty", () => {
    // Social service down means friends list comes back empty (backend graceful degradation)
    mockUseFriends.friends = [];
    mockUseFriends.totalFriends = 0;
    mockUseFriends.loading = false;
    mockUseFeed.items = [];
    mockUseFeed.loading = false;
    mockUseFeed.error = null;

    // Should show "no friends" empty state since we can't load friends
    const { getByTestId } = render(<FeedScreen />);
    expect(getByTestId("feed-empty-no-friends")).toBeTruthy();
  });

  // --- Loading state ---

  it("shows loading state during initial load", () => {
    mockUseFeed.loading = true;
    mockUseFeed.items = [];

    const { getByTestId } = render(<FeedScreen />);
    expect(getByTestId("feed-loading")).toBeTruthy();
  });

  // --- Loading more indicator ---

  it("shows loading indicator when loading more entries", () => {
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;
    mockUseFeed.items = [makeEntry({ id: "e1" })];
    mockUseFeed.loadingMore = true;

    const { getByTestId } = render(<FeedScreen />);
    expect(getByTestId("feed-loading-more")).toBeTruthy();
  });

  // --- All event types render ---

  it("renders all supported event types without crashing", () => {
    mockUseFriends.friends = [makeFriend()];
    mockUseFriends.totalFriends = 1;

    const eventTypes: FeedEventType[] = [
      "habit.completed",
      "habit.created",
      "friend.request.accepted",
      "challenge.created",
      "challenge.completed",
      "user.registered",
    ];

    mockUseFeed.items = eventTypes.map((eventType, i) =>
      makeEntry({ id: `e${i}`, eventType }),
    );

    const { getByTestId } = render(<FeedScreen />);

    eventTypes.forEach((_, i) => {
      expect(getByTestId(`feed-entry-e${i}`)).toBeTruthy();
    });
  });
});
