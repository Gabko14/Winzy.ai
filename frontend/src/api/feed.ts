import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// --- Feed types ---
// Keep in sync with: backend/internal/activity/models.go
// Spec: backend/openapi/openapi.yaml

export type FeedEventType = Schemas["FeedEventType"];
export type FeedEntryData = Record<string, unknown>;
export type FeedEntry = Schemas["FeedEntry"];
export type FeedPage = Schemas["FeedPage"];

// --- Feed API functions ---

export function fetchFeed(cursor?: string, limit = 20): Promise<FeedPage> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  return api.get<FeedPage>(`/activity/feed?${params.toString()}`);
}
