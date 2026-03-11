import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, Easing } from "react-native";
import { flameColors, getFlameGlow } from "../tokens/flame";

/**
 * Flame levels matching the backend FlameLevel enum.
 * "none" still renders as a dim ember — the flame never fully disappears.
 */
export type FlameLevel = "none" | "ember" | "steady" | "strong" | "blazing";

/** Display size variants for different contexts. */
export type FlameSize = "sm" | "md" | "lg";

export type FlameProps = {
  /** The flame intensity level from the backend. */
  flameLevel: FlameLevel;
  /** Display size: sm for list rows, md for detail views, lg for public/social. */
  size?: FlameSize;
  /**
   * Raw consistency percentage (0-100) for continuous glow intensity.
   * Optional — if omitted, glow is derived from flameLevel.
   */
  consistency?: number;
  /** Accessible label override. */
  accessibilityLabel?: string;
};

// --- Visual configuration per flame level ---

type FlameVisualConfig = {
  /** Primary flame body color */
  color: string;
  /** Inner highlight color (lighter) */
  innerColor: string;
  /** Core (brightest point) color */
  coreColor: string;
  /** Opacity of the flame body (0-1) */
  opacity: number;
  /** Scale factor for the inner flame relative to body (0-1) */
  innerScale: number;
  /** Pulse animation intensity (0 = no pulse, higher = more) */
  pulseIntensity: number;
  /** Default consistency for glow when consistency prop is not provided */
  defaultConsistency: number;
};

const flameLevelConfig: Record<FlameLevel, FlameVisualConfig> = {
  none: {
    color: flameColors.cold,
    innerColor: "#B0B8C4",
    coreColor: "#C8CED6",
    opacity: 0.4,
    innerScale: 0.3,
    pulseIntensity: 0,
    defaultConsistency: 5,
  },
  ember: {
    color: flameColors.cool,
    innerColor: "#F59E0B",
    coreColor: "#FCD34D",
    opacity: 0.7,
    innerScale: 0.45,
    pulseIntensity: 0.03,
    defaultConsistency: 20,
  },
  steady: {
    color: flameColors.warm,
    innerColor: "#F97316",
    coreColor: "#FDBA74",
    opacity: 0.85,
    innerScale: 0.55,
    pulseIntensity: 0.05,
    defaultConsistency: 42,
  },
  strong: {
    color: flameColors.hot,
    innerColor: "#EF4444",
    coreColor: "#FCA5A5",
    opacity: 0.95,
    innerScale: 0.65,
    pulseIntensity: 0.07,
    defaultConsistency: 70,
  },
  blazing: {
    color: flameColors.inferno,
    innerColor: "#F87171",
    coreColor: "#FECACA",
    opacity: 1,
    innerScale: 0.75,
    pulseIntensity: 0.1,
    defaultConsistency: 92,
  },
};

// --- Size dimensions ---
// Each size defines the container dimensions; flame shapes scale proportionally.

type SizeDimensions = {
  width: number;
  height: number;
  /** Size of the core glow dot */
  coreSize: number;
  /** Glow spread radius */
  glowSize: number;
};

const sizeConfig: Record<FlameSize, SizeDimensions> = {
  sm: { width: 24, height: 32, coreSize: 4, glowSize: 32 },
  md: { width: 36, height: 48, coreSize: 6, glowSize: 48 },
  lg: { width: 56, height: 72, coreSize: 10, glowSize: 72 },
};

export function Flame({
  flameLevel,
  size = "md",
  consistency,
  accessibilityLabel,
}: FlameProps) {
  const config = flameLevelConfig[flameLevel];
  const dims = sizeConfig[size];
  const effectiveConsistency = consistency ?? config.defaultConsistency;
  const glowOpacity = getFlameGlow(effectiveConsistency);

  // Breathing/pulse animation
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (config.pulseIntensity <= 0) {
      pulseAnim.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1 + config.pulseIntensity,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1 - config.pulseIntensity * 0.5,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [flameLevel, config.pulseIntensity, pulseAnim]);

  const label =
    accessibilityLabel ?? `Flame: ${flameLevel}, consistency ${Math.round(effectiveConsistency)}%`;

  // Flame body dimensions — teardrop shape via border radius
  const bodyWidth = dims.width * 0.7;
  const bodyHeight = dims.height * 0.75;

  // Inner flame
  const innerWidth = bodyWidth * config.innerScale;
  const innerHeight = bodyHeight * config.innerScale;

  return (
    <View
      style={[styles.container, { width: dims.width, height: dims.height }]}
      accessibilityRole="image"
      accessibilityLabel={label}
      testID="flame-container"
    >
      {/* Glow background */}
      <Animated.View
        style={[
          styles.glow,
          {
            width: dims.glowSize,
            height: dims.glowSize,
            borderRadius: dims.glowSize / 2,
            backgroundColor: config.color,
            opacity: pulseAnim.interpolate({
              inputRange: [1 - config.pulseIntensity * 0.5, 1 + config.pulseIntensity],
              outputRange: [glowOpacity * 0.6, glowOpacity],
            }),
            transform: [{ scale: pulseAnim }],
          },
        ]}
        testID="flame-glow"
      />

      {/* Main flame body — teardrop shape */}
      <Animated.View
        style={[
          styles.body,
          {
            width: bodyWidth,
            height: bodyHeight,
            borderTopLeftRadius: bodyWidth * 0.5,
            borderTopRightRadius: bodyWidth * 0.5,
            borderBottomLeftRadius: bodyWidth * 0.35,
            borderBottomRightRadius: bodyWidth * 0.35,
            backgroundColor: config.color,
            opacity: config.opacity,
            transform: [
              { scale: pulseAnim },
              { rotate: "0deg" }, // keep transform array consistent
            ],
          },
        ]}
        testID="flame-body"
      />

      {/* Inner flame — brighter core area */}
      <Animated.View
        style={[
          styles.inner,
          {
            width: innerWidth,
            height: innerHeight,
            borderTopLeftRadius: innerWidth * 0.5,
            borderTopRightRadius: innerWidth * 0.5,
            borderBottomLeftRadius: innerWidth * 0.35,
            borderBottomRightRadius: innerWidth * 0.35,
            backgroundColor: config.innerColor,
            opacity: config.opacity * 0.9,
            transform: [{ scale: pulseAnim }],
          },
        ]}
        testID="flame-inner"
      />

      {/* Core hot point */}
      <View
        style={[
          styles.core,
          {
            width: dims.coreSize,
            height: dims.coreSize,
            borderRadius: dims.coreSize / 2,
            backgroundColor: config.coreColor,
            opacity: config.opacity,
          },
        ]}
        testID="flame-core"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  glow: {
    position: "absolute",
  },
  body: {
    position: "absolute",
    bottom: "10%",
  },
  inner: {
    position: "absolute",
    bottom: "12%",
  },
  core: {
    position: "absolute",
    bottom: "20%",
  },
});
