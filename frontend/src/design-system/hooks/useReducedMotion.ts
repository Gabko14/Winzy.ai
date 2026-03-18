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
  const [reduced, setReduced] = useState(
    // In test environments, default to true to avoid async animation state
    // updates that produce act() warnings in Jest.
    () => process.env.NODE_ENV === "test",
  );

  useEffect(() => {
    if (process.env.NODE_ENV === "test") return;

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
