import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFriendProfile } from "../api/social";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function useFriendProfile(friendId: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.friend.profile(friendId),
    queryFn: () => fetchFriendProfile(friendId),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.friend.profile(friendId) });
  }, [queryClient, friendId]);

  return {
    data: query.data ?? null,
    loading: query.isPending,
    error: (query.error as ApiError | null) ?? null,
    refresh,
  };
}
