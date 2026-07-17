import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWitnessView } from "../api/witnessLinks";
import { queryKeys } from "../api/queryKeys";
import type { ApiError } from "../api/types";

export function useWitnessView(token: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.witness.view(token),
    queryFn: () => fetchWitnessView(token),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.witness.view(token) });
  }, [queryClient, token]);

  const error = query.error as ApiError | null;
  const notAvailable = error?.code === "not_found";

  return {
    data: query.data ?? null,
    loading: query.isPending,
    error: notAvailable ? null : error,
    notAvailable,
    refresh,
  };
}
