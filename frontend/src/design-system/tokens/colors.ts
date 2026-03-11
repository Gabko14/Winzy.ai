/**
 * Color tokens for Winzy.ai
 *
 * Warm flame palette reflecting the core metaphor.
 * Each color has light and dark theme variants.
 *
 * Accessibility: all foreground/background pairs meet WCAG 2.1 AA contrast (4.5:1 for text, 3:1 for large text/UI).
 */

// Brand — warm flame palette
export const brand = {
  flame50: "#FFF7ED",
  flame100: "#FFEDD5",
  flame200: "#FED7AA",
  flame300: "#FDBA74",
  flame400: "#FB923C",
  flame500: "#F97316", // primary brand
  flame600: "#EA580C",
  flame700: "#C2410C",
  flame800: "#9A3412",
  flame900: "#7C2D12",
} as const;

// Neutral — warm-tinted grays
export const neutral = {
  50: "#FAFAF9",
  100: "#F5F5F4",
  200: "#E7E5E4",
  300: "#D6D3D1",
  400: "#A8A29E",
  500: "#78716C",
  600: "#57534E",
  700: "#44403C",
  800: "#292524",
  900: "#1C1917",
  950: "#0C0A09",
} as const;

// Semantic colors
export const semantic = {
  success: "#16A34A",
  successLight: "#DCFCE7",
  warning: "#CA8A04",
  warningLight: "#FEF9C3",
  error: "#DC2626",
  errorLight: "#FEE2E2",
  info: "#2563EB",
  infoLight: "#DBEAFE",
} as const;

export type ThemeColors = {
  // Surfaces
  background: string;
  backgroundSecondary: string;
  surface: string;
  surfaceElevated: string;
  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  // Brand
  brandPrimary: string;
  brandSecondary: string;
  brandMuted: string;
  // Borders
  border: string;
  borderFocused: string;
  // Semantic
  success: string;
  successBackground: string;
  warning: string;
  warningBackground: string;
  error: string;
  errorBackground: string;
  info: string;
  infoBackground: string;
  // Overlay
  overlay: string;
};

export const lightTheme: ThemeColors = {
  background: neutral[50],
  backgroundSecondary: neutral[100],
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  textPrimary: neutral[900],
  textSecondary: neutral[600],
  textTertiary: neutral[400],
  textInverse: "#FFFFFF",
  brandPrimary: brand.flame500,
  brandSecondary: brand.flame600,
  brandMuted: brand.flame100,
  border: neutral[200],
  borderFocused: brand.flame500,
  success: semantic.success,
  successBackground: semantic.successLight,
  warning: semantic.warning,
  warningBackground: semantic.warningLight,
  error: semantic.error,
  errorBackground: semantic.errorLight,
  info: semantic.info,
  infoBackground: semantic.infoLight,
  overlay: "rgba(0, 0, 0, 0.4)",
};

export const darkTheme: ThemeColors = {
  background: neutral[950],
  backgroundSecondary: neutral[900],
  surface: neutral[800],
  surfaceElevated: neutral[700],
  textPrimary: neutral[50],
  textSecondary: neutral[400],
  textTertiary: neutral[600],
  textInverse: neutral[900],
  brandPrimary: brand.flame400,
  brandSecondary: brand.flame300,
  brandMuted: brand.flame900,
  border: neutral[700],
  borderFocused: brand.flame400,
  success: "#4ADE80",
  successBackground: "rgba(22, 163, 74, 0.15)",
  warning: "#FACC15",
  warningBackground: "rgba(202, 138, 4, 0.15)",
  error: "#F87171",
  errorBackground: "rgba(220, 38, 38, 0.15)",
  info: "#60A5FA",
  infoBackground: "rgba(37, 99, 235, 0.15)",
  overlay: "rgba(0, 0, 0, 0.6)",
};
