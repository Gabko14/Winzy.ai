import { api } from "./client";

// --- Types matching Social Service visibility contract ---
// Keep in sync with: services/social-service/src/Program.cs

export type HabitVisibility = "private" | "friends" | "public";

export type VisibilityEntry = {
  habitId: string;
  visibility: HabitVisibility;
};

export type BatchVisibilityResponse = {
  defaultVisibility: HabitVisibility;
  habits: VisibilityEntry[];
};

export type VisibilityUpdateResponse = {
  habitId: string;
  visibility: HabitVisibility;
};

export type PreferencesResponse = {
  defaultHabitVisibility: HabitVisibility;
};

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
