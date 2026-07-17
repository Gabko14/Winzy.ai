import { useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  claimChallengeInvite,
  viewChallengeInvite,
  type Challenge,
} from "../api/challenges";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function usePublicChallengeInvite(token: string) {
  const query = useQuery({
    queryKey: queryKeys.challenges.publicInvite(token),
    queryFn: () => viewChallengeInvite(token),
    enabled: token.length > 0,
  });

  const error = query.error as ApiError | null;
  const notFound = error?.code === "not_found";

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    data: query.data ?? null,
    loading: query.isPending,
    error: notFound ? null : error,
    notFound,
    refresh,
  };
}

export function useClaimChallengeInvite(onSuccess?: (challenge: Challenge) => void) {
  const mutation = useMutation({
    mutationFn: (token: string) => claimChallengeInvite(token),
    onSuccess: async (challenge, _vars, _onMutateResult, { client }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.challenges.list() }),
        client.invalidateQueries({ queryKey: queryKeys.challenges.invites() }),
        client.invalidateQueries({ queryKey: queryKeys.friends.list() }),
        client.invalidateQueries({ queryKey: queryKeys.friends.requests() }),
        client.invalidateQueries({ queryKey: queryKeys.friends.pendingCount() }),
        client.invalidateQueries({ queryKey: queryKeys.habits.list() }),
      ]);
      onSuccess?.(challenge);
    },
  });

  return {
    loading: mutation.isPending,
    error: (mutation.error as ApiError | null) ?? null,
    claim: mutation.mutateAsync,
  };
}

export function kindMessageForClaimError(err: ApiError | null): string {
  if (!err) return "Something went wrong. Please try again.";
  if (err.status === 409 || err.code === "conflict") {
    return err.message || "This invite is no longer active";
  }
  if (err.status === 404 || err.code === "not_found") {
    return "This invite is no longer active";
  }
  if (err.code === "validation" && err.validationErrors) {
    return Object.values(err.validationErrors).flat().join(". ") || err.message;
  }
  return err.message || "Something went wrong. Please try again.";
}
