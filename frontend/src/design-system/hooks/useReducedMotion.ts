import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/**
 * Returns true when the user prefers reduced motion.
 *
 * - iOS/Android: listens to AccessibilityInfo.isReduceMotionEnabled
 * - Web: reads the `prefers-reduced-motion: reduce` media query
 *
 * Components should skip or shorten animations when this returns true.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.matchMedia) {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        setReduced(mq.matches);
        const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
      }
      return;
    }

    // Native: iOS & Android
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => subscription.remove();
  }, []);

  return reduced;
}
