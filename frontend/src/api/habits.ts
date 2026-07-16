import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// --- Types matching backend contract ---
// Keep in sync with: backend/internal/habits/models.go
// Spec: backend/openapi/openapi.yaml

export type FrequencyType = Schemas["FrequencyType"];
export type CompletionKind = Schemas["CompletionKind"];
export type Habit = Schemas["Habit"];
export type CreateHabitRequest = Schemas["CreateHabitRequest"];
export type UpdateHabitRequest = Schemas["UpdateHabitRequest"];

// --- API functions ---

export function fetchHabits(): Promise<Habit[]> {
  return api.get<Habit[]>("/habits");
}

export function fetchHabit(id: string): Promise<Habit> {
  return api.get<Habit>(`/habits/${id}`);
}

export function createHabit(request: CreateHabitRequest): Promise<Habit> {
  return api.post<Habit>("/habits", request);
}

export function updateHabit(id: string, request: UpdateHabitRequest): Promise<Habit> {
  return api.put<Habit>(`/habits/${id}`, request);
}

export function archiveHabit(id: string): Promise<void> {
  return api.delete<void>(`/habits/${id}`);
}

// --- Stats & completions (habit detail screen) ---
// Keep in sync with: backend/internal/habits/handlers.go (stats + complete)
// Spec: backend/openapi/openapi.yaml

export type FlameLevel = Schemas["FlameLevel"];
export type CompletionDateEntry = Schemas["CompletionDateEntry"];
export type HabitStats = Schemas["HabitStats"];
export type HabitCompletion = Schemas["HabitCompletion"];
export type CompleteHabitRequest = Schemas["CompleteHabitRequest"];

export function fetchHabitStats(id: string, timezone: string): Promise<HabitStats> {
  return api.get<HabitStats>(`/habits/${id}/stats`, {
    headers: { "X-Timezone": timezone },
  });
}

export function completeHabit(id: string, request: CompleteHabitRequest): Promise<HabitCompletion> {
  return api.post<HabitCompletion>(`/habits/${id}/complete`, request);
}

export function deleteCompletion(habitId: string, date: string): Promise<void> {
  return api.delete<void>(`/habits/${habitId}/completions/${date}`);
}

export function updateCompletion(
  habitId: string,
  date: string,
  completionKind: CompletionKind,
): Promise<HabitCompletion> {
  return api.put<HabitCompletion>(`/habits/${habitId}/completions/${date}`, {
    completionKind,
  });
}
