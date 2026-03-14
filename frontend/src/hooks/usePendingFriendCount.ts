import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { fetchFriendRequests } from "../api/social";

const POLL_INTERVAL_MS = 30_000;

export function usePendingFriendCount() {
  const [count, setCount] = useState(0);
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await fetchFriendRequests();
      if (mountedRef.current) {
        setCount(data.incoming.length);
      }
    } catch {
      // Silently ignore — badge is non-critical
    }
  }, []);

  const refresh = useCallback(() => {
    poll();
  }, [poll]);

  useEffect(() => {
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
      }
      subscription.remove();
    };
  }, [poll]);

  return { count, refresh };
}
