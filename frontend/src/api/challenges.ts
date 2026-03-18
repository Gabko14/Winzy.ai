import { api } from "./client";

// --- Challenge types ---
// Keep in sync with: services/challenge-service/src/Program.cs (MapToResponse / MapToDetailResponse)

export type MilestoneType =
  | "consistencyTarget"
  | "daysInPeriod"
  | "totalCompletions"
  | "customDateRange"
  | "improvementMilestone";

export type ChallengeStatus = "active" | "completed" | "claimed" | "cancelled" | "expired";

export type Challenge = {
  id: string;
  habitId: string;
  creatorId: string;
  recipientId: string;
  milestoneType: MilestoneType;
  targetValue: number;
  periodDays: number;
  rewardDescription: string;
  status: ChallengeStatus;
  createdAt: string;
  endsAt: string;
  completedAt: string | null;
  claimedAt: string | null;
};

export type ChallengeDetail = Challenge & {
  /** Progress toward the milestone as a 0.0–1.0 fraction (backend: ProgressCalculator.CalculateProgress). */
  progress: number;
  completionCount: number;
  baselineConsistency: number | null;
  customStartDate: string | null;
  customEndDate: string | null;
  /** Creator's display name, enriched by challenge-service via auth batch profiles. */
  creatorDisplayName: string | null;
};

export type ChallengesPage = {
  items: ChallengeDetail[];
  page: number;
  pageSize: number;
  total: number;
};

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

// --- Create challenge ---

export type CreateChallengeRequest = {
  habitId: string;
  recipientId: string;
  milestoneType: MilestoneType;
  targetValue: number;
  periodDays: number;
  rewardDescription: string;
  customStartDate?: string;
  customEndDate?: string;
};

export function createChallenge(request: CreateChallengeRequest): Promise<Challenge> {
  return api.post<Challenge>("/challenges", request);
}

// --- Claim challenge ---

export function claimChallenge(id: string): Promise<Challenge> {
  return api.put<Challenge>(`/challenges/${id}/claim`);
}
