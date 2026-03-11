import React, { useEffect, useRef } from "react";
import { Animated, ViewStyle } from "react-native";
import { useReducedMotion } from "../hooks/useReducedMotion";

export type ShakeViewProps = {
  children: React.ReactNode;
  /** Whether to trigger the shake animation. Shakes once when this goes from false to true. */
  shake: boolean;
  /** Shake intensity in pixels. Default 6. */
  intensity?: number;
  /** Animation duration (ms). Default 400. */
  duration?: number;
  /** Optional container style. */
  style?: ViewStyle;
};

/**
 * Wraps children in a gentle horizontal shake animation.
 * Use for error states to draw attention without aggression.
 * Respects reduced motion: no animation when enabled.
 */
export function ShakeView({
  children,
  shake,
  intensity = 6,
  duration = 400,
  style,
}: ShakeViewProps) {
  const reducedMotion = useReducedMotion();
  const translateX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!shake || reducedMotion) return;

    const animation = Animated.sequence([
      Animated.timing(translateX, {
        toValue: intensity,
        duration: duration / 6,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: -intensity,
        duration: duration / 6,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: intensity * 0.6,
        duration: duration / 6,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: -intensity * 0.6,
        duration: duration / 6,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: intensity * 0.2,
        duration: duration / 6,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: 0,
        duration: duration / 6,
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [shake, reducedMotion, intensity, duration, translateX]);

  return (
    <Animated.View
      style={[style, { transform: [{ translateX }] }]}
      testID="shake-view"
    >
      {children}
    </Animated.View>
  );
}
