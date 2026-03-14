import { useCallback, useEffect, useState } from "react";
import {
  fetchChallenges,
  fetchChallengeDetail,
  type Challenge,
  type ChallengeDetail,
} from "../api/challenges";
import type { ApiError } from "../api/types";

type ChallengesState = {
  challenges: Challenge[];
  loading: boolean;
  error: ApiError | null;
};

export function useChallenges() {
  const [state, setState] = useState<ChallengesState>({
    challenges: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchChallenges(1, 100);
      setState({ challenges: data.items, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err as ApiError }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, refresh: load };
}

type ChallengeDetailState = {
  challenge: ChallengeDetail | null;
  loading: boolean;
  error: ApiError | null;
};

export function useChallengeDetail(id: string) {
  const [state, setState] = useState<ChallengeDetailState>({
    challenge: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const challenge = await fetchChallengeDetail(id);
      setState({ challenge, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err as ApiError }));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, refresh: load };
}

/** Returns active challenges for a specific habit from the user's challenge list. */
export function useHabitChallenges(habitId: string) {
  const [state, setState] = useState<{
    challenges: ChallengeDetail[];
    loading: boolean;
    error: ApiError | null;
  }>({
    challenges: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // TODO(winzy.ai-n+1): N+1 API calls — fetches list then detail for each.
      // Fix by adding progress fields to the list endpoint response.
      const data = await fetchChallenges(1, 100);
      const habitChallenges = data.items.filter(
        (c) => c.habitId === habitId && c.status === "active",
      );
      const details = await Promise.all(
        habitChallenges.map((c) => fetchChallengeDetail(c.id)),
      );
      setState({ challenges: details, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err as ApiError }));
    }
  }, [habitId]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, refresh: load };
}
