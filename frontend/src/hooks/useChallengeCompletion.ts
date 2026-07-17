import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  claimChallenge,
  type ChallengeDetail,
} from "../api/challenges";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";
import { challengesListQueryOptions } from "./useChallenges";

const POLL_INTERVAL_MS = 30_000;

type ChallengeCompletionState = {
  queue: ChallengeDetail[];
  claiming: boolean;
  claimError: ApiError | null;
};

/**
 * Detects newly completed challenges via the shared challenges list query
 * (refetchInterval) and surfaces them for celebration one at a time.
 */
export function useChallengeCompletion(isAuthenticated = true) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ChallengeCompletionState>({
    queue: [],
    claiming: false,
    claimError: null,
  });

  const seenCompletedIds = useRef(new Set<string>());
  const initialLoadDone = useRef(false);

  const query = useQuery({
    ...challengesListQueryOptions(),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      setState({ queue: [], claiming: false, claimError: null });
      initialLoadDone.current = false;
      seenCompletedIds.current.clear();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !query.data) return;

    const items = query.data.items;

    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      for (const c of items) {
        if (c.status === "completed" || c.status === "claimed") {
          seenCompletedIds.current.add(c.id);
        }
      }
      return;
    }

    const newlyCompleted = items.filter(
      (c) => c.status === "completed" && !seenCompletedIds.current.has(c.id),
    );

    if (newlyCompleted.length === 0) return;

    for (const c of newlyCompleted) {
      seenCompletedIds.current.add(c.id);
    }
    setState((s) => ({
      ...s,
      queue: [...s.queue, ...newlyCompleted],
    }));
  }, [query.data, isAuthenticated]);

  const current = state.queue.length > 0 ? state.queue[0] : null;

  const claimMutation = useMutation({
    mutationFn: (id: string) => claimChallenge(id),
    onSuccess: async (_data, id) => {
      seenCompletedIds.current.add(id);
      setState((s) => ({
        ...s,
        queue: s.queue.filter((c) => c.id !== id),
        claiming: false,
        claimError: null,
      }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.challenges.list() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.feed.list() }),
      ]);
    },
    onError: (err) => {
      setState((s) => ({
        ...s,
        claiming: false,
        claimError: err as unknown as ApiError,
      }));
    },
  });

  const claim = useCallback(async () => {
    if (!current || claimMutation.isPending) return;
    setState((s) => ({ ...s, claiming: true, claimError: null }));
    try {
      await claimMutation.mutateAsync(current.id);
    } catch {
      // onError already recorded claimError
    }
  }, [current, claimMutation]);

  const dismiss = useCallback(() => {
    if (!current) return;
    seenCompletedIds.current.add(current.id);
    setState((s) => ({
      ...s,
      queue: s.queue.slice(1),
      claimError: null,
    }));
  }, [current]);

  const triggerCheck = useCallback(() => {
    if (!isAuthenticated) return;
    void query.refetch();
  }, [isAuthenticated, query]);

  return {
    current,
    queueLength: state.queue.length,
    remainingCount: Math.max(0, state.queue.length - 1),
    claiming: state.claiming || claimMutation.isPending,
    claimError: state.claimError,
    claim,
    dismiss,
    triggerCheck,
  };
}
