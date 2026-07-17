import { useCallback } from "react";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import {
  createChallengeInvite,
  listChallengeInvites,
  revokeChallengeInvite,
  type CreateChallengeInviteRequest,
} from "../api/challenges";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function challengeInvitesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.challenges.invites(),
    queryFn: () => listChallengeInvites(),
  });
}

export function useChallengeInvites() {
  const query = useQuery(challengeInvitesQueryOptions());

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    invites: query.data?.items ?? [],
    loading: query.isPending,
    error: (query.error as ApiError | null) ?? null,
    refresh,
  };
}

export function useCreateChallengeInvite(
  onSuccess?: (result: Awaited<ReturnType<typeof createChallengeInvite>>) => void,
) {
  const mutation = useMutation({
    mutationFn: (request: CreateChallengeInviteRequest) => createChallengeInvite(request),
    onSuccess: async (result, _vars, _onMutateResult, { client }) => {
      await client.invalidateQueries({ queryKey: queryKeys.challenges.invites() });
      onSuccess?.(result);
    },
  });

  return {
    loading: mutation.isPending,
    error: (mutation.error as ApiError | null) ?? null,
    create: mutation.mutateAsync,
  };
}

export function useRevokeChallengeInvite() {
  const mutation = useMutation({
    mutationFn: (id: string) => revokeChallengeInvite(id),
    onSuccess: async (_data, _vars, _onMutateResult, { client }) => {
      await client.invalidateQueries({ queryKey: queryKeys.challenges.invites() });
    },
  });

  return {
    loading: mutation.isPending,
    error: (mutation.error as ApiError | null) ?? null,
    revoke: mutation.mutateAsync,
  };
}
