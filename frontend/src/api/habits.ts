import { api } from "./client";

// --- Types matching backend contract ---
// Keep in sync with: services/habit-service/src/Entities/Habit.cs

export type FrequencyType = "daily" | "weekly" | "custom";

export type CompletionKind = "full" | "minimum";

export type Habit = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  frequency: FrequencyType;
  customDays: number[] | null;
  minimumDescription: string | null;
  createdAt: string;
  archivedAt: string | null;
};

export type CreateHabitRequest = {
  name: string;
  icon?: string;
  color?: string;
  frequency: FrequencyType;
  customDays?: number[];
  minimumDescription?: string;
};

export type UpdateHabitRequest = {
  name?: string;
  icon?: string;
  color?: string;
  frequency?: FrequencyType;
  customDays?: number[];
  minimumDescription?: string;
  clearMinimumDescription?: boolean;
};

/** Backend enum values for CompletionKind */
export const COMPLETION_KIND = { full: 1, minimum: 2 } as const;

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
// Keep in sync with: services/habit-service/src/Program.cs (stats + complete endpoints)

export type FlameLevel = "none" | "ember" | "steady" | "strong" | "blazing";

export type CompletionDateEntry = {
  date: string;
  completionKind: CompletionKind;
};

export type HabitStats = {
  habitId: string;
  consistency: number;
  flameLevel: FlameLevel;
  totalCompletions: number;
  completionsInWindow: number;
  completedToday: boolean;
  completedTodayKind: CompletionKind | null;
  windowDays: number;
  windowStart: string;
  today: string;
  completedDates: CompletionDateEntry[];
};

export type HabitCompletion = {
  id: string;
  habitId: string;
  localDate: string;
  completedAt: string;
  completionKind: CompletionKind;
  consistency: number;
};

export type CompleteHabitRequest = {
  date?: string;
  timezone: string;
  completionKind?: number; // 1=full, 2=minimum (backend enum)
};

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
  completionKind: number, // 1=full, 2=minimum (backend enum)
): Promise<HabitCompletion> {
  return api.put<HabitCompletion>(`/habits/${habitId}/completions/${date}`, {
    completionKind,
  });
}
