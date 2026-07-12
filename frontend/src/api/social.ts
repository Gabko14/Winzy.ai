import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// --- Friends types ---
// Keep in sync with: backend/internal/social/models.go
// Spec: backend/openapi/openapi.yaml

// Enrichment fields stay optional at the facade boundary so existing call sites
// and test fixtures (Partial<Friend> factories) remain assignable.
export type Friend = Omit<
  Schemas["Friend"],
  "flameLevel" | "consistency" | "habitsUnavailable"
> & {
  flameLevel?: Schemas["FlameLevel"];
  consistency?: number;
  habitsUnavailable?: boolean;
};

export type FriendsPage = Omit<Schemas["FriendsPage"], "items"> & {
  items: Friend[];
};

export type IncomingRequest = Schemas["IncomingRequest"];
export type OutgoingRequest = Schemas["OutgoingRequest"];
export type FriendRequestsResponse = Schemas["FriendRequestsResponse"];
export type FriendRequestResult = Schemas["FriendRequestResult"];

// --- Friend profile types ---
// Keep in sync with: backend/internal/social/models.go (friend profile)
// Spec: backend/openapi/openapi.yaml

export type FriendHabit = Schemas["FriendHabit"];
export type FriendProfileResponse = Omit<Schemas["FriendProfileResponse"], "habitsUnavailable"> & {
  habitsUnavailable?: boolean;
};

// --- User search types ---
// Keep in sync with: backend/internal/auth/models.go (UserSearchResult)
// Spec: backend/openapi/openapi.yaml

export type UserSearchResult = Schemas["UserSearchResult"];

// --- Friends API functions ---

export function fetchFriends(page = 1, pageSize = 20): Promise<FriendsPage> {
  return api.get<FriendsPage>(`/social/friends?page=${page}&pageSize=${pageSize}`);
}

export function fetchFriendRequests(): Promise<FriendRequestsResponse> {
  return api.get<FriendRequestsResponse>("/social/friends/requests");
}

export function fetchPendingFriendCount(): Promise<{ count: number }> {
  return api.get<{ count: number }>("/social/friends/requests/count");
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

export function fetchFriendProfile(friendId: string): Promise<FriendProfileResponse> {
  return api.get<FriendProfileResponse>(`/social/friends/${friendId}/profile`);
}
