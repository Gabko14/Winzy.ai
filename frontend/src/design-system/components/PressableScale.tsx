import React, { useRef, useCallback } from "react";
import { Animated, Pressable, PressableProps, ViewStyle } from "react-native";
import { motion } from "../tokens/spacing";
import { useReducedMotion } from "../hooks/useReducedMotion";

export type PressableScaleProps = Omit<PressableProps, "style"> & {
  children: React.ReactNode;
  /** Scale factor when pressed. Default 0.97 (subtle). */
  activeScale?: number;
  /** Optional container style. */
  style?: ViewStyle;
};

/**
 * A Pressable wrapper that provides scale + opacity touch feedback.
 * Respects reduced motion: falls back to opacity-only feedback.
 */
export function PressableScale({
  children,
  activeScale = 0.97,
  style,
  ...pressableProps
}: PressableScaleProps) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = useCallback(
    (toValue: number) => {
      Animated.timing(scale, {
        toValue,
        duration: motion.fast,
        useNativeDriver: true,
      }).start();
    },
    [scale],
  );

  const handlePressIn = useCallback(() => {
    if (!reducedMotion) {
      animateTo(activeScale);
    }
  }, [reducedMotion, activeScale, animateTo]);

  const handlePressOut = useCallback(() => {
    if (!reducedMotion) {
      animateTo(1);
    }
  }, [reducedMotion, animateTo]);

  return (
    <Pressable
      {...pressableProps}
      onPressIn={(e) => {
        handlePressIn();
        pressableProps.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        handlePressOut();
        pressableProps.onPressOut?.(e);
      }}
    >
      <Animated.View
        style={[
          style,
          {
            transform: [{ scale }],
          },
        ]}
        testID="pressable-scale-inner"
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
