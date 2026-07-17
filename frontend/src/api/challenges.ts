import { api, apiRequest } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// --- Challenge types ---
// Keep in sync with: backend/internal/challenges/models.go
// Spec: backend/openapi/openapi.yaml

export type MilestoneType = Schemas["MilestoneType"];
export type ChallengeStatus = Schemas["ChallengeStatus"];
export type Challenge = Schemas["Challenge"];
export type ChallengeDetail = Schemas["ChallengeDetail"];
export type ChallengesPage = Schemas["ChallengesPage"];
export type CreateChallengeRequest = Schemas["CreateChallengeRequest"];

export type ChallengeInviteStatus = Schemas["ChallengeInviteStatus"];
export type CreateChallengeInviteRequest = Schemas["CreateChallengeInviteRequest"];
export type CreateChallengeInviteResponse = Schemas["CreateChallengeInviteResponse"];
export type ChallengeInvite = Schemas["ChallengeInvite"];
export type ChallengeInvitesResponse = Schemas["ChallengeInvitesResponse"];
export type PublicChallengeInvite = Schemas["PublicChallengeInvite"];

// --- API functions ---

export function fetchChallenges(page = 1, pageSize = 20): Promise<ChallengesPage> {
  return api.get<ChallengesPage>(`/challenges?page=${page}&pageSize=${pageSize}`);
}

export function fetchChallengesByStatus(
  status: ChallengeStatus,
  since?: string,
  page = 1,
  pageSize = 100,
): Promise<ChallengesPage> {
  let url = `/challenges?page=${page}&pageSize=${pageSize}&status=${status}`;
  if (since) url += `&since=${encodeURIComponent(since)}`;
  return api.get<ChallengesPage>(url);
}

export function fetchChallengeDetail(id: string): Promise<ChallengeDetail> {
  return api.get<ChallengeDetail>(`/challenges/${id}`);
}

export function createChallenge(request: CreateChallengeRequest): Promise<Challenge> {
  return api.post<Challenge>("/challenges", request);
}

export function claimChallenge(id: string): Promise<Challenge> {
  return api.put<Challenge>(`/challenges/${id}/claim`);
}

export function createChallengeInvite(
  request: CreateChallengeInviteRequest,
): Promise<CreateChallengeInviteResponse> {
  return api.post<CreateChallengeInviteResponse>("/challenges/invites", request);
}

export function listChallengeInvites(): Promise<ChallengeInvitesResponse> {
  return api.get<ChallengeInvitesResponse>("/challenges/invites");
}

export function revokeChallengeInvite(id: string): Promise<void> {
  return api.delete<void>(`/challenges/invites/${id}`);
}

export function viewChallengeInvite(token: string): Promise<PublicChallengeInvite> {
  return apiRequest<PublicChallengeInvite>(
    `/challenges/invites/${encodeURIComponent(token)}`,
    { noAuth: true },
  );
}

export function claimChallengeInvite(token: string): Promise<Challenge> {
  return api.post<Challenge>(`/challenges/invites/${encodeURIComponent(token)}/claim`);
}
