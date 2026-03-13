import { api } from "./client";

// --- Friends types ---
// Keep in sync with: services/social-service/src/Program.cs (GET /social/friends, etc.)

export type Friend = {
  friendId: string;
  since: string;
  // Optional profile fields — populated when backend enrichment is available (winzy.ai-3vq)
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type FriendsPage = {
  items: Friend[];
  page: number;
  pageSize: number;
  total: number;
};

export type IncomingRequest = {
  id: string;
  fromUserId: string;
  direction: "incoming";
  createdAt: string;
  // Optional profile fields — populated when backend enrichment is available (winzy.ai-3vq)
  fromUsername?: string;
  fromDisplayName?: string | null;
};

export type OutgoingRequest = {
  id: string;
  toUserId: string;
  direction: "outgoing";
  createdAt: string;
  // Optional profile fields — populated when backend enrichment is available (winzy.ai-3vq)
  toUsername?: string;
  toDisplayName?: string | null;
};

export type FriendRequestsResponse = {
  incoming: IncomingRequest[];
  outgoing: OutgoingRequest[];
};

export type FriendRequestResult = {
  id: string;
  userId: string;
  friendId: string;
  status: string;
  createdAt: string;
};

// --- User search types ---
// Keep in sync with: services/auth-service/src/Endpoints/AuthEndpoints.cs (SearchUsers)

export type UserSearchResult = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

// --- Friends API functions ---

export function fetchFriends(page = 1, pageSize = 20): Promise<FriendsPage> {
  return api.get<FriendsPage>(`/social/friends?page=${page}&pageSize=${pageSize}`);
}

export function fetchFriendRequests(): Promise<FriendRequestsResponse> {
  return api.get<FriendRequestsResponse>("/social/friends/requests");
}

export function sendFriendRequest(friendId: string): Promise<FriendRequestResult> {
  return api.post<FriendRequestResult>("/social/friends/request", { friendId });
}

export function acceptFriendRequest(requestId: string): Promise<FriendRequestResult> {
  return api.put<FriendRequestResult>(`/social/friends/request/${requestId}/accept`);
}

export function declineFriendRequest(requestId: string): Promise<void> {
  return api.put<void>(`/social/friends/request/${requestId}/decline`);
}

export function removeFriend(friendId: string): Promise<void> {
  return api.delete<void>(`/social/friends/${friendId}`);
}

export function searchUsers(query: string): Promise<UserSearchResult[]> {
  return api.get<UserSearchResult[]>(`/auth/users/search?q=${encodeURIComponent(query)}`);
}
