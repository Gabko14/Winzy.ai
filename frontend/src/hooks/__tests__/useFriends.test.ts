import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useFriends } from "../useFriends";

jest.mock("../../api/social", () => ({
  fetchFriends: jest.fn(),
  fetchFriendRequests: jest.fn(),
  acceptFriendRequest: jest.fn(),
  declineFriendRequest: jest.fn(),
  removeFriend: jest.fn(),
}));

const {
  fetchFriends,
  fetchFriendRequests,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
} = jest.requireMock("../../api/social");

const mockFriend = {
  friendId: "u1",
  since: "2026-01-15T00:00:00Z",
  username: "alice",
  displayName: "Alice",
  avatarUrl: null,
};

const mockFriend2 = {
  friendId: "u2",
  since: "2026-02-01T00:00:00Z",
  username: "bob",
  displayName: "Bob",
  avatarUrl: null,
};

const mockIncoming = {
  id: "req-1",
  fromUserId: "u3",
  direction: "incoming" as const,
  createdAt: "2026-03-01T00:00:00Z",
  fromUsername: "charlie",
  fromDisplayName: "Charlie",
};

const mockOutgoing = {
  id: "req-2",
  toUserId: "u4",
  direction: "outgoing" as const,
  createdAt: "2026-03-02T00:00:00Z",
  toUsername: "diana",
  toDisplayName: "Diana",
};

function mockDefaultResponses() {
  fetchFriends.mockResolvedValue({
    items: [mockFriend],
    page: 1,
    pageSize: 100,
    total: 1,
  });
  fetchFriendRequests.mockResolvedValue({
    incoming: [mockIncoming],
    outgoing: [mockOutgoing],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useFriends", () => {
  // --- Happy path ---

  it("loads friends and requests on mount", async () => {
    mockDefaultResponses();

    const { result } = renderHook(() => useFriends());

    expect(result.current.loading).toBe(true);
    expect(result.current.requestsLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.requestsLoading).toBe(false);
    });

    expect(result.current.friends).toEqual([mockFriend]);
    expect(result.current.totalFriends).toBe(1);
    expect(result.current.incoming).toEqual([mockIncoming]);
    expect(result.current.outgoing).toEqual([mockOutgoing]);
    expect(result.current.error).toBeNull();
    expect(result.current.requestsError).toBeNull();
  });

  it("acceptRequest removes from incoming and refreshes friends", async () => {
    mockDefaultResponses();
    acceptFriendRequest.mockResolvedValue({
      id: "req-1",
      userId: "u3",
      friendId: "self",
      status: "accepted",
      createdAt: mockIncoming.createdAt,
    });

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // After accepting, loadFriends is called again — return updated list
    const newFriend = {
      friendId: "u3",
      since: "2026-03-14T00:00:00Z",
      username: "charlie",
      displayName: "Charlie",
      avatarUrl: null,
    };
    fetchFriends.mockResolvedValue({
      items: [mockFriend, newFriend],
      page: 1,
      pageSize: 100,
      total: 2,
    });

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.acceptRequest("req-1");
    });

    expect(success).toBe(true);
    expect(acceptFriendRequest).toHaveBeenCalledWith("req-1");
    expect(result.current.incoming).toEqual([]);
    expect(result.current.friends).toEqual([mockFriend, newFriend]);
    expect(result.current.totalFriends).toBe(2);
  });

  it("declineRequest removes from incoming", async () => {
    mockDefaultResponses();
    declineFriendRequest.mockResolvedValue(undefined);

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.declineRequest("req-1");
    });

    expect(success).toBe(true);
    expect(declineFriendRequest).toHaveBeenCalledWith("req-1");
    expect(result.current.incoming).toEqual([]);
  });

  it("cancelRequest removes from outgoing", async () => {
    mockDefaultResponses();
    declineFriendRequest.mockResolvedValue(undefined);

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.cancelRequest("req-2");
    });

    expect(success).toBe(true);
    // cancelRequest calls declineFriendRequest under the hood
    expect(declineFriendRequest).toHaveBeenCalledWith("req-2");
    expect(result.current.outgoing).toEqual([]);
  });

  it("removeFriend removes from list and decrements total", async () => {
    fetchFriends.mockResolvedValue({
      items: [mockFriend, mockFriend2],
      page: 1,
      pageSize: 100,
      total: 2,
    });
    fetchFriendRequests.mockResolvedValue({ incoming: [], outgoing: [] });
    removeFriend.mockResolvedValue(undefined);

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.friends).toHaveLength(2);
    expect(result.current.totalFriends).toBe(2);

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.removeFriend("u1");
    });

    expect(success).toBe(true);
    expect(removeFriend).toHaveBeenCalledWith("u1");
    expect(result.current.friends).toEqual([mockFriend2]);
    expect(result.current.totalFriends).toBe(1);
  });

  it("refresh reloads both friends and requests", async () => {
    mockDefaultResponses();

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Clear call counts
    fetchFriends.mockClear();
    fetchFriendRequests.mockClear();

    fetchFriends.mockResolvedValue({
      items: [mockFriend, mockFriend2],
      page: 1,
      pageSize: 100,
      total: 2,
    });
    fetchFriendRequests.mockResolvedValue({ incoming: [], outgoing: [] });

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchFriends).toHaveBeenCalledTimes(1);
    expect(fetchFriendRequests).toHaveBeenCalledTimes(1);
    expect(result.current.friends).toEqual([mockFriend, mockFriend2]);
    expect(result.current.incoming).toEqual([]);
  });

  // --- Edge cases ---

  it("handles empty friends and requests", async () => {
    fetchFriends.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });
    fetchFriendRequests.mockResolvedValue({ incoming: [], outgoing: [] });

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.friends).toEqual([]);
    expect(result.current.totalFriends).toBe(0);
    expect(result.current.incoming).toEqual([]);
    expect(result.current.outgoing).toEqual([]);
  });

  it("ignores state updates after unmount", async () => {
    // Use a never-resolving promise to simulate slow API
    let resolveFriends!: (value: unknown) => void;
    fetchFriends.mockReturnValue(
      new Promise((resolve) => {
        resolveFriends = resolve;
      }),
    );
    fetchFriendRequests.mockResolvedValue({ incoming: [], outgoing: [] });

    const { result, unmount } = renderHook(() => useFriends());

    expect(result.current.loading).toBe(true);

    // Unmount before the API resolves
    unmount();

    // Resolve after unmount — should not throw or update state
    resolveFriends({
      items: [mockFriend],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    // No assertion on state — just verifying no errors are thrown
  });

  // --- Error conditions ---

  it("sets error when fetchFriends fails", async () => {
    const apiError = { status: 500, code: "server_error", message: "Internal error" };
    fetchFriends.mockRejectedValue(apiError);
    fetchFriendRequests.mockResolvedValue({ incoming: [], outgoing: [] });

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.friends).toEqual([]);
  });

  it("sets requestsError when fetchFriendRequests fails", async () => {
    fetchFriends.mockResolvedValue({
      items: [mockFriend],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    const apiError = { status: 0, code: "network", message: "Network error" };
    fetchFriendRequests.mockRejectedValue(apiError);

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.requestsLoading).toBe(false);
    });

    expect(result.current.requestsError).toEqual(apiError);
    // Friends should still load successfully
    expect(result.current.friends).toEqual([mockFriend]);
  });

  it("acceptRequest returns false on API failure", async () => {
    mockDefaultResponses();
    acceptFriendRequest.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Failed",
    });

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.acceptRequest("req-1");
    });

    expect(success).toBe(false);
    // Incoming list should NOT be modified on failure
    expect(result.current.incoming).toEqual([mockIncoming]);
  });

  it("declineRequest returns false on API failure", async () => {
    mockDefaultResponses();
    declineFriendRequest.mockRejectedValue({
      status: 500,
      code: "server_error",
      message: "Failed",
    });

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.declineRequest("req-1");
    });

    expect(success).toBe(false);
  });

  it("removeFriend returns false on API failure", async () => {
    mockDefaultResponses();
    removeFriend.mockRejectedValue({
      status: 0,
      code: "network",
      message: "Network error",
    });

    const { result } = renderHook(() => useFriends());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.removeFriend("u1");
    });

    expect(success).toBe(false);
    // Friends list should NOT be modified on failure
    expect(result.current.friends).toEqual([mockFriend]);
  });
});
