import { api, apiRequest } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// --- Types matching backend contract ---
// Keep in sync with: backend/internal/social/models.go (witness-link endpoints)
// Spec: backend/openapi/openapi.yaml

export type WitnessLink = Schemas["WitnessLink"];
export type WitnessLinksResponse = Schemas["WitnessLinksResponse"];
export type CreateWitnessLinkRequest = Schemas["CreateWitnessLinkRequest"];
export type UpdateWitnessLinkRequest = Schemas["UpdateWitnessLinkRequest"];
export type WitnessHabitPromise = Schemas["PublicPromise"];
export type WitnessHabit = Schemas["WitnessHabit"];
export type WitnessViewResponse = Schemas["WitnessViewResponse"];

// --- API functions ---

export function createWitnessLink(request: CreateWitnessLinkRequest): Promise<WitnessLink> {
  return api.post<WitnessLink>("/social/witness-links", request);
}

export function listWitnessLinks(): Promise<WitnessLinksResponse> {
  return api.get<WitnessLinksResponse>("/social/witness-links");
}

export function updateWitnessLink(id: string, request: UpdateWitnessLinkRequest): Promise<WitnessLink> {
  return api.put<WitnessLink>(`/social/witness-links/${id}`, request);
}

export function revokeWitnessLink(id: string): Promise<void> {
  return api.delete<void>(`/social/witness-links/${id}`);
}

export function rotateWitnessLink(id: string): Promise<WitnessLink> {
  return api.post<WitnessLink>(`/social/witness-links/${id}/rotate`);
}

export function fetchWitnessView(token: string): Promise<WitnessViewResponse> {
  return apiRequest<WitnessViewResponse>(
    `/social/witness/${encodeURIComponent(token)}`,
    { noAuth: true },
  );
}
