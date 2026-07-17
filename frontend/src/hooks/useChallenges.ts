import { useCallback, useMemo } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchChallenges,
  fetchChallengeDetail,
  claimChallenge,
  createChallenge,
  type ChallengeDetail,
  type CreateChallengeRequest,
} from "../api/challenges";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function challengesListQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.challenges.list(),
    queryFn: () => fetchChallenges(1, 100),
  });
}

export function useChallenges() {
  const query = useQuery(challengesListQueryOptions());

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    challenges: query.data?.items ?? [],
    loading: query.isPending,
    error: (query.error as ApiError | null) ?? null,
    refresh,
  };
}

export function useChallengeDetail(id: string) {
  const query = useQuery({
    queryKey: queryKeys.challenges.detail(id),
    queryFn: () => fetchChallengeDetail(id),
    enabled: id.length > 0,
  });

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    challenge: query.data ?? null,
    loading: query.isPending,
    error: (query.error as ApiError | null) ?? null,
    refresh,
  };
}

/** Active challenges for a specific habit, derived from the shared challenges list. */
export function useHabitChallenges(habitId: string) {
  const { challenges, loading, error, refresh } = useChallenges();

  const habitChallenges = useMemo(
    () => challenges.filter((c) => c.habitId === habitId && c.status === "active"),
    [challenges, habitId],
  );

  return { challenges: habitChallenges, loading, error, refresh };
}

async function invalidateChallengeSurfaces(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.challenges.list() }),
    queryClient.invalidateQueries({ queryKey: ["challenge"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.feed.list() }),
  ]);
}

export function useClaimChallenge(onSuccess?: (challenge: ChallengeDetail) => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => claimChallenge(id),
    onSuccess: async (challenge) => {
      await invalidateChallengeSurfaces(queryClient);
      onSuccess?.(challenge as ChallengeDetail);
    },
  });

  return {
    loading: mutation.isPending,
    error: (mutation.error as ApiError | null) ?? null,
    claim: mutation.mutateAsync,
  };
}

export function useCreateChallenge(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (request: CreateChallengeRequest) => createChallenge(request),
    onSuccess: async () => {
      await invalidateChallengeSurfaces(queryClient);
      onSuccess?.();
    },
  });

  return {
    loading: mutation.isPending,
    error: (mutation.error as ApiError | null) ?? null,
    create: mutation.mutateAsync,
  };
}
