import { useEffect, useState } from "react";
import { Dimensions, Platform } from "react-native";

/**
 * Responsive breakpoints (mobile-first).
 *
 * sm:  0-599   (phone)
 * md:  600-959 (tablet / small desktop)
 * lg:  960+    (desktop)
 */
export type Breakpoint = "sm" | "md" | "lg";

export const breakpoints = {
  sm: 0,
  md: 600,
  lg: 960,
} as const;

function getBreakpoint(width: number): Breakpoint {
  if (width >= breakpoints.lg) return "lg";
  if (width >= breakpoints.md) return "md";
  return "sm";
}

export function useResponsive() {
  const [width, setWidth] = useState(() => Dimensions.get("window").width);

  useEffect(() => {
    if (Platform.OS !== "web") {
      const sub = Dimensions.addEventListener("change", ({ window }) => {
        setWidth(window.width);
      });
      return () => sub.remove();
    }

    // Web: use matchMedia for efficient breakpoint changes
    if (typeof window === "undefined") return;

    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const breakpoint = getBreakpoint(width);

  return {
    width,
    breakpoint,
    isMobile: breakpoint === "sm",
    isTablet: breakpoint === "md",
    isDesktop: breakpoint === "lg",
  };
}
