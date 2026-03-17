import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  fetchChallenges,
  claimChallenge,
  type ChallengeDetail,
} from "../api/challenges";
import type { ApiError } from "../api/types";

const POLL_INTERVAL_MS = 30_000;

type ChallengeCompletionState = {
  /** Queue of challenges waiting to be celebrated */
  queue: ChallengeDetail[];
  /** Whether a claim is in flight */
  claiming: boolean;
  /** Last claim error (shown as retry in the overlay) */
  claimError: ApiError | null;
};

/**
 * Detects newly completed challenges by polling and surfaces them
 * for celebration one at a time. Provides a claim action for the
 * currently displayed challenge.
 *
 * Detection: polls challenges every 30s. When a challenge with
 * status "completed" appears that hasn't been seen before, it's
 * queued for celebration.
 */
export function useChallengeCompletion() {
  const [state, setState] = useState<ChallengeCompletionState>({
    queue: [],
    claiming: false,
    claimError: null,
  });

  // Track IDs we've already seen as completed (or claimed) to avoid re-celebrating
  const seenCompletedIds = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const initialLoadDone = useRef(false);
  const checkInFlight = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const checkForCompletions = useCallback(async () => {
    // Guard against concurrent checks (poll + triggerCheck racing)
    if (checkInFlight.current) return;
    checkInFlight.current = true;

    try {
      const data = await fetchChallenges(1, 100);
      if (!mountedRef.current) return;

      // On first load, just seed the seen set — don't celebrate pre-existing completions
      if (!initialLoadDone.current) {
        initialLoadDone.current = true;
        for (const c of data.items) {
          if (c.status === "completed" || c.status === "claimed") {
            seenCompletedIds.current.add(c.id);
          }
        }
        return;
      }

      const newlyCompleted = data.items.filter(
        (c) =>
          c.status === "completed" && !seenCompletedIds.current.has(c.id),
      );

      if (newlyCompleted.length > 0) {
        for (const c of newlyCompleted) {
          seenCompletedIds.current.add(c.id);
        }
        setState((s) => ({
          ...s,
          queue: [...s.queue, ...newlyCompleted],
        }));
      }
    } catch {
      // Polling failure is non-fatal — just skip this cycle
    } finally {
      checkInFlight.current = false;
    }
  }, []);

  // Initial load + polling with page visibility pause
  useEffect(() => {
    checkForCompletions();
    let interval = setInterval(checkForCompletions, POLL_INTERVAL_MS);

    // Pause polling when tab is backgrounded (web only)
    function handleVisibilityChange() {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        // Resume: check immediately then restart interval
        checkForCompletions();
        interval = setInterval(checkForCompletions, POLL_INTERVAL_MS);
      }
    }

    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      clearInterval(interval);
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [checkForCompletions]);

  /** The challenge currently being celebrated (front of queue) */
  const current = state.queue.length > 0 ? state.queue[0] : null;

  /** Claim the reward for the current challenge and dismiss it */
  const claim = useCallback(async () => {
    if (!current) return;

    setState((s) => ({ ...s, claiming: true, claimError: null }));

    try {
      await claimChallenge(current.id);
      if (!mountedRef.current) return;

      // Remove from queue
      setState((s) => ({
        ...s,
        queue: s.queue.slice(1),
        claiming: false,
        claimError: null,
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState((s) => ({
        ...s,
        claiming: false,
        claimError: err as ApiError,
      }));
    }
  }, [current]);

  /** Dismiss without claiming (user can claim later from MyChallenges) */
  const dismiss = useCallback(() => {
    setState((s) => ({
      ...s,
      queue: s.queue.slice(1),
      claimError: null,
    }));
  }, []);

  /** Force a check — call this when a push notification arrives */
  const triggerCheck = useCallback(() => {
    checkForCompletions();
  }, [checkForCompletions]);

  return {
    current,
    claiming: state.claiming,
    claimError: state.claimError,
    remainingCount: Math.max(0, state.queue.length - 1),
    claim,
    dismiss,
    triggerCheck,
  };
}
