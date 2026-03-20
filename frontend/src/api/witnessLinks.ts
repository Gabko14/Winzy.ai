import { api, apiRequest } from "./client";

// --- Types matching backend contract ---
// Keep in sync with: services/social-service/src/Program.cs (witness-link endpoints)

export type WitnessLink = {
  id: string;
  token: string;
  label: string | null;
  habitIds: string[];
  createdAt: string;
};

export type WitnessLinksResponse = {
  items: WitnessLink[];
};

export type CreateWitnessLinkRequest = {
  label?: string;
  habitIds?: string[];
};

export type UpdateWitnessLinkRequest = {
  label?: string;
  habitIds?: string[];
};

export type WitnessHabit = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  consistency: number;
  flameLevel: "none" | "ember" | "steady" | "strong" | "blazing";
};

export type WitnessViewResponse = {
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  habits: WitnessHabit[];
  habitsUnavailable: boolean;
};

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
