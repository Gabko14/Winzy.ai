import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// --- Types matching Social Service visibility contract ---
// Keep in sync with: backend/internal/social/models.go
// Spec: backend/openapi/openapi.yaml

export type HabitVisibility = Schemas["HabitVisibility"];
export type VisibilityEntry = Schemas["VisibilityEntry"];
export type BatchVisibilityResponse = Schemas["BatchVisibilityResponse"];
export type VisibilityUpdateResponse = Schemas["VisibilityUpdateResponse"];
export type PreferencesResponse = Schemas["PreferencesResponse"];

// --- API functions ---

export function fetchVisibility(): Promise<BatchVisibilityResponse> {
  return api.get<BatchVisibilityResponse>("/social/visibility");
}

export function updateVisibility(
  habitId: string,
  visibility: HabitVisibility,
): Promise<VisibilityUpdateResponse> {
  return api.put<VisibilityUpdateResponse>(`/social/visibility/${habitId}`, {
    visibility,
  });
}

export function fetchPreferences(): Promise<PreferencesResponse> {
  return api.get<PreferencesResponse>("/social/preferences");
}

export function updateDefaultVisibility(
  visibility: HabitVisibility,
): Promise<PreferencesResponse> {
  return api.put<PreferencesResponse>("/social/preferences", {
    defaultHabitVisibility: visibility,
  });
}
