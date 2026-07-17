import { useCallback } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchFriends,
  fetchFriendRequests,
  acceptFriendRequest as apiAcceptRequest,
  declineFriendRequest as apiDeclineRequest,
  removeFriend as apiRemoveFriend,
  type FriendRequestsResponse,
  type FriendsPage,
} from "../api/social";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function friendsListQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.friends.list(),
    queryFn: () => fetchFriends(1, 100),
  });
}

export function friendRequestsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.friends.requests(),
    queryFn: fetchFriendRequests,
  });
}

export function useFriends() {
  const queryClient = useQueryClient();

  const friendsQuery = useQuery(friendsListQueryOptions());
  const requestsQuery = useQuery(friendRequestsQueryOptions());

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.list() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests() }),
    ]);
  }, [queryClient]);

  const acceptMutation = useMutation({
    mutationFn: (requestId: string) => apiAcceptRequest(requestId),
    onMutate: async (requestId, { client }) => {
      await client.cancelQueries({ queryKey: queryKeys.friends.requests() });
      const previous = client.getQueryData<FriendRequestsResponse>(queryKeys.friends.requests());
      if (previous) {
        client.setQueryData<FriendRequestsResponse>(queryKeys.friends.requests(), {
          ...previous,
          incoming: previous.incoming.filter((r) => r.id !== requestId),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, onMutateResult, { client }) => {
      if (onMutateResult?.previous) {
        client.setQueryData(queryKeys.friends.requests(), onMutateResult.previous);
      }
    },
    onSettled: (_data, _error, _vars, _onMutateResult, { client }) => {
      void Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.friends.list() }),
        client.invalidateQueries({ queryKey: queryKeys.friends.requests() }),
        client.invalidateQueries({ queryKey: queryKeys.friends.pendingCount() }),
        client.invalidateQueries({ queryKey: ["feed"] }),
      ]);
    },
  });

  const declineMutation = useMutation({
    mutationFn: (requestId: string) => apiDeclineRequest(requestId),
    onMutate: async (requestId, { client }) => {
      await client.cancelQueries({ queryKey: queryKeys.friends.requests() });
      const previous = client.getQueryData<FriendRequestsResponse>(queryKeys.friends.requests());
      if (previous) {
        client.setQueryData<FriendRequestsResponse>(queryKeys.friends.requests(), {
          ...previous,
          incoming: previous.incoming.filter((r) => r.id !== requestId),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, onMutateResult, { client }) => {
      if (onMutateResult?.previous) {
        client.setQueryData(queryKeys.friends.requests(), onMutateResult.previous);
      }
    },
    onSettled: (_data, _error, _vars, _onMutateResult, { client }) => {
      void Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.friends.requests() }),
        client.invalidateQueries({ queryKey: queryKeys.friends.pendingCount() }),
      ]);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (requestId: string) => apiDeclineRequest(requestId),
    onMutate: async (requestId, { client }) => {
      await client.cancelQueries({ queryKey: queryKeys.friends.requests() });
      const previous = client.getQueryData<FriendRequestsResponse>(queryKeys.friends.requests());
      if (previous) {
        client.setQueryData<FriendRequestsResponse>(queryKeys.friends.requests(), {
          ...previous,
          outgoing: previous.outgoing.filter((r) => r.id !== requestId),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, onMutateResult, { client }) => {
      if (onMutateResult?.previous) {
        client.setQueryData(queryKeys.friends.requests(), onMutateResult.previous);
      }
    },
    onSettled: (_data, _error, _vars, _onMutateResult, { client }) => {
      void client.invalidateQueries({ queryKey: queryKeys.friends.requests() });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (friendId: string) => apiRemoveFriend(friendId),
    onMutate: async (friendId, { client }) => {
      await client.cancelQueries({ queryKey: queryKeys.friends.list() });
      const previous = client.getQueryData<FriendsPage>(queryKeys.friends.list());
      if (previous) {
        client.setQueryData<FriendsPage>(queryKeys.friends.list(), {
          ...previous,
          items: previous.items.filter((f) => f.friendId !== friendId),
          total: Math.max(0, previous.total - 1),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, onMutateResult, { client }) => {
      if (onMutateResult?.previous) {
        client.setQueryData(queryKeys.friends.list(), onMutateResult.previous);
      }
    },
    onSettled: (_data, _error, friendId, _onMutateResult, { client }) => {
      void Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.friends.list() }),
        client.invalidateQueries({ queryKey: ["feed"] }),
        client.invalidateQueries({ queryKey: queryKeys.friend.profile(friendId) }),
      ]);
    },
  });

  const acceptRequest = useCallback(
    async (requestId: string): Promise<boolean> => {
      try {
        await acceptMutation.mutateAsync(requestId);
        return true;
      } catch {
        return false;
      }
    },
    [acceptMutation.mutateAsync],
  );

  const declineRequest = useCallback(
    async (requestId: string): Promise<boolean> => {
      try {
        await declineMutation.mutateAsync(requestId);
        return true;
      } catch {
        return false;
      }
    },
    [declineMutation.mutateAsync],
  );

  const cancelRequest = useCallback(
    async (requestId: string): Promise<boolean> => {
      try {
        await cancelMutation.mutateAsync(requestId);
        return true;
      } catch {
        return false;
      }
    },
    [cancelMutation.mutateAsync],
  );

  const removeFriend = useCallback(
    async (friendId: string): Promise<boolean> => {
      try {
        await removeMutation.mutateAsync(friendId);
        return true;
      } catch {
        return false;
      }
    },
    [removeMutation.mutateAsync],
  );

  const friendsPage = friendsQuery.data;

  return {
    friends: friendsPage?.items ?? [],
    totalFriends: friendsPage?.total ?? 0,
    incoming: requestsQuery.data?.incoming ?? [],
    outgoing: requestsQuery.data?.outgoing ?? [],
    loading: friendsQuery.isPending,
    requestsLoading: requestsQuery.isPending,
    error: (friendsQuery.error as ApiError | null) ?? null,
    requestsError: (requestsQuery.error as ApiError | null) ?? null,
    refresh,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriend,
  };
}
