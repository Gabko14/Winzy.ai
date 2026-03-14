import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFeed, type FeedEntry } from "../api/feed";
import type { ApiError } from "../api/types";

type FeedState = {
  items: FeedEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
};

export function useFeed(limit = 20) {
  const [state, setState] = useState<FeedState>({
    items: [],
    nextCursor: null,
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: null,
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (cursor: string | undefined, append: boolean) => {
      if (!append) {
        setState((s) => ({ ...s, loading: true, error: null }));
      } else {
        setState((s) => ({ ...s, loadingMore: true }));
      }

      try {
        const data = await fetchFeed(cursor, limit);
        if (!mountedRef.current) return;

        setState((s) => ({
          ...s,
          items: append ? [...s.items, ...data.items] : data.items,
          nextCursor: data.nextCursor,
          hasMore: data.hasMore,
          loading: false,
          loadingMore: false,
          error: null,
        }));
      } catch (err) {
        if (!mountedRef.current) return;
        setState((s) => ({
          ...s,
          loading: false,
          loadingMore: false,
          error: err as ApiError,
        }));
      }
    },
    [limit],
  );

  // Initial load
  useEffect(() => {
    load(undefined, false);
  }, [load]);

  const refresh = useCallback(() => load(undefined, false), [load]);

  const loadMore = useCallback(() => {
    if (!state.hasMore || state.loadingMore || !state.nextCursor) return;
    load(state.nextCursor, true);
  }, [load, state.hasMore, state.loadingMore, state.nextCursor]);

  return {
    items: state.items,
    hasMore: state.hasMore,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    refresh,
    loadMore,
  };
}
