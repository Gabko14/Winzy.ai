import { useCallback } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFeed } from "../api/feed";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function useFeed(limit = 20) {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: queryKeys.feed.list(limit),
    queryFn: ({ pageParam }) => fetchFeed(pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const lastPage = query.data?.pages[query.data.pages.length - 1];

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.feed.list(limit) });
  }, [queryClient, limit]);

  const loadMore = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    void query.fetchNextPage();
  }, [query]);

  return {
    items,
    hasMore: lastPage?.hasMore ?? false,
    loading: query.isPending,
    loadingMore: query.isFetchingNextPage,
    error: (query.error as ApiError | null) ?? null,
    refresh,
    loadMore,
  };
}
