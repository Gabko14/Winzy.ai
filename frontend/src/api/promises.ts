import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// --- Promise types ---
// Keep in sync with: backend/internal/habits/promise_models.go
// Spec: backend/openapi/openapi.yaml

export type PromiseStatus = Schemas["PromiseStatus"];
export type FlamePromise = Schemas["FlamePromise"];
export type PublicPromise = Schemas["PublicPromise"];
export type PromiseResponse = Schemas["PromiseResponse"];
export type CreatePromiseRequest = Schemas["CreatePromiseRequest"];

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
  timezone: string,
): Promise<FlamePromise> {
  return api.post<FlamePromise>(`/habits/${habitId}/promise`, request, {
    headers: { "X-Timezone": timezone },
  });
}

export function cancelPromise(habitId: string): Promise<void> {
  return api.delete<void>(`/habits/${habitId}/promise`);
}

export function togglePromiseVisibility(
  habitId: string,
  isPublicOnFlame: boolean,
): Promise<{ isPublicOnFlame: boolean }> {
  return api.patch<{ isPublicOnFlame: boolean }>(
    `/habits/${habitId}/promise/visibility`,
    { isPublicOnFlame },
  );
}
