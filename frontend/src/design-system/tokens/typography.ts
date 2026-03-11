import { Platform, TextStyle } from "react-native";

/**
 * Typography scale for Winzy.ai
 *
 * Uses system fonts for native feel across platforms.
 * Scale follows a modular ratio (~1.25) for visual harmony.
 */

const fontFamily = Platform.select({
  ios: "System",
  android: "Roboto",
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  default: "System",
});

export const fontSizes = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
} as const;

export const lineHeights = {
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.75,
} as const;

export const fontWeights = {
  regular: "400" as TextStyle["fontWeight"],
  medium: "500" as TextStyle["fontWeight"],
  semibold: "600" as TextStyle["fontWeight"],
  bold: "700" as TextStyle["fontWeight"],
};

export const typography = {
  h1: {
    fontFamily,
    fontSize: fontSizes["4xl"],
    lineHeight: fontSizes["4xl"] * lineHeights.tight,
    fontWeight: fontWeights.bold,
  },
  h2: {
    fontFamily,
    fontSize: fontSizes["3xl"],
    lineHeight: fontSizes["3xl"] * lineHeights.tight,
    fontWeight: fontWeights.bold,
  },
  h3: {
    fontFamily,
    fontSize: fontSizes["2xl"],
    lineHeight: fontSizes["2xl"] * lineHeights.tight,
    fontWeight: fontWeights.semibold,
  },
  h4: {
    fontFamily,
    fontSize: fontSizes.xl,
    lineHeight: fontSizes.xl * lineHeights.tight,
    fontWeight: fontWeights.semibold,
  },
  bodyLarge: {
    fontFamily,
    fontSize: fontSizes.lg,
    lineHeight: fontSizes.lg * lineHeights.normal,
    fontWeight: fontWeights.regular,
  },
  body: {
    fontFamily,
    fontSize: fontSizes.base,
    lineHeight: fontSizes.base * lineHeights.normal,
    fontWeight: fontWeights.regular,
  },
  bodySmall: {
    fontFamily,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * lineHeights.normal,
    fontWeight: fontWeights.regular,
  },
  caption: {
    fontFamily,
    fontSize: fontSizes.xs,
    lineHeight: fontSizes.xs * lineHeights.normal,
    fontWeight: fontWeights.regular,
  },
  label: {
    fontFamily,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * lineHeights.normal,
    fontWeight: fontWeights.medium,
  },
  button: {
    fontFamily,
    fontSize: fontSizes.base,
    lineHeight: fontSizes.base * lineHeights.tight,
    fontWeight: fontWeights.semibold,
  },
  buttonSmall: {
    fontFamily,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * lineHeights.tight,
    fontWeight: fontWeights.semibold,
  },
} as const satisfies Record<string, TextStyle>;
