import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, ViewStyle, Easing } from "react-native";
import { radii } from "../tokens/spacing";
import { lightTheme } from "../tokens/colors";
import { useReducedMotion } from "../hooks/useReducedMotion";

export type SkeletonLoaderProps = {
  /** Width of the skeleton. Can be number or percentage string. */
  width: number | `${number}%`;
  /** Height of the skeleton. Default 16. */
  height?: number;
  /** Border radius. Default radii.md (8). */
  borderRadius?: number;
  /** Whether the skeleton is circular. Overrides borderRadius. */
  circle?: boolean;
  /** Optional container style. */
  style?: ViewStyle;
};

/**
 * A pulsing skeleton placeholder for loading states.
 * Replaces spinners with a more polished, content-aware loading experience.
 * Respects reduced motion: shows static gray bar instead of pulsing.
 */
export function SkeletonLoader({
  width,
  height = 16,
  borderRadius = radii.md,
  circle = false,
  style,
}: SkeletonLoaderProps) {
  const reducedMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.3)).current;
  const colors = lightTheme;

  const effectiveBorderRadius = circle ? (typeof width === "number" ? width / 2 : 9999) : borderRadius;
  const effectiveHeight = circle && typeof width === "number" ? width : height;

  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(0.5);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.7,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [reducedMotion, pulse]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height: effectiveHeight,
          borderRadius: effectiveBorderRadius,
          backgroundColor: colors.backgroundSecondary,
          opacity: pulse,
        },
        style,
      ]}
      testID="skeleton-loader"
      accessibilityRole="none"
      accessibilityLabel="Loading"
    />
  );
}

const styles = StyleSheet.create({
  skeleton: {
    overflow: "hidden",
  },
});
