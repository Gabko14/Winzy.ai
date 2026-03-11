import { useEffect, useState } from "react";
import { Platform } from "react-native";

/**
 * Tracks browser online/offline state.
 * On native, always returns true (native has its own NetInfo handling).
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => {
    if (Platform.OS === "web" && typeof navigator !== "undefined") {
      return navigator.onLine;
    }
    return true;
  });

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
