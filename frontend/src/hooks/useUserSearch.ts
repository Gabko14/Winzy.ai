import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchUsers } from "../api/social";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function useUserSearch(debounceMs = 300) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setDebouncedQuery("");
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  const searchQuery = useQuery({
    queryKey: queryKeys.users.search(debouncedQuery),
    queryFn: () => searchUsers(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  });

  const clear = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
  }, []);

  const trimmedLive = query.trim();
  const awaitingDebounce = trimmedLive.length >= 2 && trimmedLive !== debouncedQuery;

  return {
    query,
    setQuery,
    results: debouncedQuery.length >= 2 ? (searchQuery.data ?? []) : [],
    loading: awaitingDebounce || (debouncedQuery.length >= 2 && searchQuery.isFetching),
    error: (searchQuery.error as ApiError | null) ?? null,
    clear,
  };
}
