import React, { useEffect, useRef } from "react";
import { Animated, View, StyleSheet, Easing, ViewStyle } from "react-native";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { lightTheme } from "../tokens/colors";

export type AnimatedCheckmarkProps = {
  /** Whether to show the checkmark with animation. */
  visible: boolean;
  /** Size of the checkmark circle. Default 32. */
  size?: number;
  /** Color of the checkmark. Defaults to success color. */
  color?: string;
  /** Optional container style. */
  style?: ViewStyle;
};

/**
 * A satisfying checkmark animation for habit completion.
 * Bounces in with scale overshoot when visible becomes true.
 * Respects reduced motion: appears immediately without animation.
 */
export function AnimatedCheckmark({
  visible,
  size = 32,
  color,
  style,
}: AnimatedCheckmarkProps) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const checkColor = color ?? lightTheme.success;

  useEffect(() => {
    if (reducedMotion) {
      scale.setValue(visible ? 1 : 0);
      opacity.setValue(visible ? 1 : 0);
      return;
    }

    if (visible) {
      const animation = Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          friction: 4,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]);
      animation.start();
      return () => animation.stop();
    } else {
      const animation = Animated.parallel([
        Animated.timing(scale, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]);
      animation.start();
      return () => animation.stop();
    }
  }, [visible, reducedMotion, scale, opacity]);

  // Checkmark is drawn with two rotated Views forming an "L" shape
  const strokeWidth = Math.max(2, size * 0.1);
  const shortArm = size * 0.25;
  const longArm = size * 0.45;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: checkColor,
          opacity,
          transform: [{ scale }],
        },
        style,
      ]}
      testID="animated-checkmark"
      accessibilityRole="image"
      accessibilityLabel="Completed"
    >
      <View style={styles.checkmarkContainer}>
        {/* Short arm of checkmark (going down-left) */}
        <View
          style={[
            styles.checkStroke,
            {
              width: shortArm,
              height: strokeWidth,
              backgroundColor: "#FFFFFF",
              transform: [{ rotate: "45deg" }],
              left: size * 0.15,
              top: size * 0.38,
            },
          ]}
        />
        {/* Long arm of checkmark (going down-right) */}
        <View
          style={[
            styles.checkStroke,
            {
              width: longArm,
              height: strokeWidth,
              backgroundColor: "#FFFFFF",
              transform: [{ rotate: "-45deg" }],
              left: size * 0.3,
              top: size * 0.3,
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  checkmarkContainer: {
    position: "relative",
    width: "100%",
    height: "100%",
  },
  checkStroke: {
    position: "absolute",
    borderRadius: 1,
  },
});
