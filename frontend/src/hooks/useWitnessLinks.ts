import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listWitnessLinks,
  createWitnessLink as apiCreate,
  revokeWitnessLink as apiRevoke,
  rotateWitnessLink as apiRotate,
  updateWitnessLink as apiUpdate,
  type CreateWitnessLinkRequest,
  type UpdateWitnessLinkRequest,
  type WitnessLink,
  type WitnessLinksResponse,
} from "../api/witnessLinks";
import { habitsListQueryOptions } from "./useHabits";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function useWitnessLinks() {
  const queryClient = useQueryClient();

  const linksQuery = useQuery({
    queryKey: queryKeys.witnessLinks.list(),
    queryFn: listWitnessLinks,
  });

  const habitsQuery = useQuery(habitsListQueryOptions());

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.witnessLinks.list() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.habits.list() }),
    ]);
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (request: CreateWitnessLinkRequest) => apiCreate(request),
    onSuccess: (newLink, _vars, _onMutateResult, { client }) => {
      client.setQueryData<WitnessLinksResponse>(queryKeys.witnessLinks.list(), (old) => {
        if (!old) return { items: [newLink] };
        return { ...old, items: [newLink, ...old.items] };
      });
    },
    onSettled: (_data, _error, _vars, _onMutateResult, { client }) => {
      void client.invalidateQueries({ queryKey: queryKeys.witnessLinks.list() });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiRevoke(id),
    onMutate: async (id, { client }) => {
      await client.cancelQueries({ queryKey: queryKeys.witnessLinks.list() });
      const previous = client.getQueryData<WitnessLinksResponse>(queryKeys.witnessLinks.list());
      if (previous) {
        client.setQueryData<WitnessLinksResponse>(queryKeys.witnessLinks.list(), {
          ...previous,
          items: previous.items.filter((l) => l.id !== id),
        });
      }
      return { previous };
    },
    onError: (_err, _id, onMutateResult, { client }) => {
      if (onMutateResult?.previous) {
        client.setQueryData(queryKeys.witnessLinks.list(), onMutateResult.previous);
      }
    },
    onSettled: (_data, _error, id, _onMutateResult, { client }) => {
      void Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.witnessLinks.list() }),
        client.invalidateQueries({ queryKey: ["witness"] }),
      ]);
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (id: string) => apiRotate(id),
    onSuccess: (updated, _vars, _onMutateResult, { client }) => {
      client.setQueryData<WitnessLinksResponse>(queryKeys.witnessLinks.list(), (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((l) => (l.id === updated.id ? updated : l)),
        };
      });
    },
    onSettled: (_data, _error, id, _onMutateResult, { client }) => {
      void Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.witnessLinks.list() }),
        client.invalidateQueries({ queryKey: ["witness"] }),
      ]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, request }: { id: string; request: UpdateWitnessLinkRequest }) =>
      apiUpdate(id, request),
    onSuccess: (updated, _vars, _onMutateResult, { client }) => {
      client.setQueryData<WitnessLinksResponse>(queryKeys.witnessLinks.list(), (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((l) => (l.id === updated.id ? updated : l)),
        };
      });
    },
    onSettled: (_data, _error, _vars, _onMutateResult, { client }) => {
      void Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.witnessLinks.list() }),
        client.invalidateQueries({ queryKey: ["witness"] }),
      ]);
    },
  });

  const activeHabits = (habitsQuery.data ?? []).filter((h) => !h.archivedAt);

  return {
    links: linksQuery.data?.items ?? [],
    habits: activeHabits,
    loading: linksQuery.isPending || habitsQuery.isPending,
    error: ((linksQuery.error ?? habitsQuery.error) as ApiError | null) ?? null,
    refresh,
    create: createMutation.mutateAsync,
    creating: createMutation.isPending,
    createError: (createMutation.error as ApiError | null) ?? null,
    revoke: revokeMutation.mutateAsync,
    rotate: rotateMutation.mutateAsync,
    update: (id: string, request: UpdateWitnessLinkRequest) =>
      updateMutation.mutateAsync({ id, request }),
    updating: updateMutation.isPending,
    updateError: (updateMutation.error as ApiError | null) ?? null,
  };
}

export type { WitnessLink };
