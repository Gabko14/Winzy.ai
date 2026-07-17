import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchPendingFriendCount as fetchCount } from "../api/social";
import { queryKeys } from "../api/queryKeys";

const POLL_INTERVAL_MS = 30_000;

/**
 * Tracks pending friend request count with polling.
 *
 * @param isAuthenticated - Gate polling on auth status. When false, count resets
 *   to 0 and polling stops so the badge doesn't show stale data after logout.
 */
export function usePendingFriendCount(isAuthenticated = true) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.friends.pendingCount(),
    queryFn: fetchCount,
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.friends.pendingCount() });
  }, [queryClient]);

  return {
    count: isAuthenticated ? (query.data?.count ?? 0) : 0,
    refresh,
  };
}
