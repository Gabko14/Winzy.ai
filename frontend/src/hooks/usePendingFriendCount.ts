import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { fetchPendingFriendCount as fetchCount } from "../api/social";

const POLL_INTERVAL_MS = 30_000;

/**
 * Tracks pending friend request count with polling.
 *
 * @param isAuthenticated - Gate polling on auth status. When false, count resets
 *   to 0 and polling stops so the badge doesn't show stale data after logout.
 */
export function usePendingFriendCount(isAuthenticated = true) {
  const [count, setCount] = useState(0);
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const data = await fetchCount();
      if (mountedRef.current && !cancelledRef.current) {
        setCount(data.count);
      }
    } catch {
      // Silently ignore — badge is non-critical
    }
  }, []);

  const refresh = useCallback(() => {
    poll();
  }, [poll]);

  // Clear stale state and cancel in-flight fetches when auth drops
  useEffect(() => {
    if (!isAuthenticated) {
      cancelledRef.current = true;
      setCount(0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    cancelledRef.current = false;
    mountedRef.current = true;

    poll();

    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        poll();
        if (!intervalRef.current) {
          intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
        }
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    const subscription = AppState.addEventListener("change", handleAppState);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      subscription.remove();
    };
  }, [poll, isAuthenticated]);

  return { count, refresh };
}
