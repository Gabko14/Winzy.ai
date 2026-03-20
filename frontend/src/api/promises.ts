import { api } from "./client";

// --- Promise types ---
// Keep in sync with: services/habit-service/src/Entities/Promise.cs + Program.cs (MapPromiseToResponse)

export type PromiseStatus = "active" | "kept" | "endedbelow" | "cancelled";

export type FlamePromise = {
  id: string;
  habitId: string;
  targetConsistency: number;
  endDate: string;
  privateNote: string | null;
  status: PromiseStatus;
  onTrack: boolean | null;
  currentConsistency: number | null;
  statement: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type PromiseResponse = {
  active: FlamePromise | null;
  history: FlamePromise[];
};

export type CreatePromiseRequest = {
  targetConsistency: number;
  endDate: string;
  privateNote?: string;
};

// --- API functions ---

export function fetchPromise(
  habitId: string,
  timezone: string,
  includeHistory = false,
): Promise<PromiseResponse> {
  const params = includeHistory ? "?history=true" : "";
  return api.get<PromiseResponse>(`/habits/${habitId}/promise${params}`, {
    headers: { "X-Timezone": timezone },
  });
}

export function createPromise(
  habitId: string,
  request: CreatePromiseRequest,
): Promise<FlamePromise> {
  // The create endpoint returns the promise directly (not wrapped in active/history)
  // but the response shape matches FlamePromise
  return api.post<FlamePromise>(`/habits/${habitId}/promise`, request);
}

export function cancelPromise(habitId: string): Promise<void> {
  return api.delete<void>(`/habits/${habitId}/promise`);
}
