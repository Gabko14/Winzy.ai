import { useCallback, useEffect, useRef, useState } from "react";
import { searchUsers, type UserSearchResult } from "../api/social";
import type { ApiError } from "../api/types";

type SearchState = {
  results: UserSearchResult[];
  loading: boolean;
  error: ApiError | null;
};

export function useUserSearch(debounceMs = 300) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({
    results: [],
    loading: false,
    error: null,
  });

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setState({ results: [], loading: false, error: null });
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    timerRef.current = setTimeout(async () => {
      try {
        const results = await searchUsers(trimmed);
        if (!mountedRef.current) return;
        setState({ results, loading: false, error: null });
      } catch (err) {
        if (!mountedRef.current) return;
        setState({ results: [], loading: false, error: err as ApiError });
      }
    }, debounceMs);
  }, [query, debounceMs]);

  const clear = useCallback(() => {
    setQuery("");
    setState({ results: [], loading: false, error: null });
  }, []);

  return {
    query,
    setQuery,
    results: state.results,
    loading: state.loading,
    error: state.error,
    clear,
  };
}
