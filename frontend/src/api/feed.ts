import { api } from "./client";

// --- Feed types ---
// Keep in sync with: services/activity-service/src/Program.cs (GET /activity/feed)

export type FeedEventType =
  | "habit.completed"
  | "habit.created"
  | "friend.request.accepted"
  | "challenge.created"
  | "challenge.completed"
  | "user.registered";

export type FeedEntryData = Record<string, unknown>;

export type FeedEntry = {
  id: string;
  actorId: string;
  eventType: FeedEventType;
  data: FeedEntryData | null;
  createdAt: string;
};

export type FeedPage = {
  items: FeedEntry[];
  nextCursor: string | null;
  hasMore: boolean;
};

// --- Feed API functions ---

export function fetchFeed(cursor?: string, limit = 20): Promise<FeedPage> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  return api.get<FeedPage>(`/activity/feed?${params.toString()}`);
}
