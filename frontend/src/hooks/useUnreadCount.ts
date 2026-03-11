import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { fetchUnreadCount } from "../api/notifications";

const POLL_INTERVAL_MS = 30_000;

export function useUnreadCount() {
  const [count, setCount] = useState(0);
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await fetchUnreadCount();
      if (mountedRef.current) {
        setCount(data.unreadCount);
      }
    } catch {
      // Silently ignore — badge is non-critical
    }
  }, []);

  // Decrement locally after marking one as read (avoids waiting for next poll)
  const decrementBy = useCallback((n: number) => {
    setCount((prev) => Math.max(0, prev - n));
  }, []);

  // Reset to zero locally (mark-all-read)
  const resetToZero = useCallback(() => {
    setCount(0);
  }, []);

  // Force refresh (e.g., after opening notifications screen)
  const refresh = useCallback(() => {
    poll();
  }, [poll]);

  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    poll();

    // Poll on interval
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    // Pause polling when app is backgrounded, resume on foreground
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

  return { count, decrementBy, resetToZero, refresh };
}
