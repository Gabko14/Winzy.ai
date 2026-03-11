import React, { useEffect, useRef } from "react";
import { Animated, ViewStyle } from "react-native";
import { motion } from "../tokens/spacing";
import { useReducedMotion } from "../hooks/useReducedMotion";

export type FadeInProps = {
  children: React.ReactNode;
  /** Delay before animation starts (ms). Use for staggered lists. */
  delay?: number;
  /** Animation duration (ms). Defaults to motion.normal (250ms). */
  duration?: number;
  /** Optional style for the animated container. */
  style?: ViewStyle;
};

/**
 * Wraps children in a fade-in + slight slide-up animation on mount.
 * Respects reduced motion: renders immediately without animation.
 */
export function FadeIn({ children, delay = 0, duration = motion.normal, style }: FadeInProps) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reducedMotion ? 0 : 8)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [reducedMotion, delay, duration, opacity, translateY]);

  return (
    <Animated.View
      style={[{ opacity, transform: [{ translateY }] }, style]}
      testID="fade-in"
    >
      {children}
    </Animated.View>
  );
}
