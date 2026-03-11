/**
 * Flame-specific tokens for the consistency visualization.
 *
 * The Flame is the heart of Winzy.ai — a visual representation of habit consistency
 * over a 60-day rolling window. It grows from a tiny ember (cold) to a blazing flame (hot).
 *
 * Color scale maps consistency percentage to visual warmth.
 * Size scale maps consistency to flame dimensions.
 */

/** Flame color stops from cold (low consistency) to hot (high consistency) */
export const flameColors = {
  /** 0-10% — barely there, cool gray ember */
  cold: "#9CA3AF",
  /** 10-25% — faint warmth starting */
  cool: "#D97706",
  /** 25-45% — warming up */
  warm: "#EA580C",
  /** 45-65% — solid consistency */
  hot: "#F97316",
  /** 65-85% — strong flame */
  blazing: "#EF4444",
  /** 85-100% — on fire */
  inferno: "#DC2626",
} as const;

/** Maps a consistency percentage (0-100) to a flame color */
export function getFlameColor(consistency: number): string {
  if (consistency <= 10) return flameColors.cold;
  if (consistency <= 25) return flameColors.cool;
  if (consistency <= 45) return flameColors.warm;
  if (consistency <= 65) return flameColors.hot;
  if (consistency <= 85) return flameColors.blazing;
  return flameColors.inferno;
}

/** Flame sizing tokens — width and height scale with consistency */
export const flameSizes = {
  /** Tiny ember for the lowest consistency */
  xs: { width: 16, height: 20 },
  /** Small flame */
  sm: { width: 24, height: 32 },
  /** Medium flame — default display size */
  md: { width: 32, height: 44 },
  /** Large flame — profile/detail view */
  lg: { width: 48, height: 64 },
  /** Extra large — hero display */
  xl: { width: 64, height: 88 },
} as const;

/** Maps a consistency percentage (0-100) to a flame size key */
export function getFlameSize(consistency: number): keyof typeof flameSizes {
  if (consistency <= 15) return "xs";
  if (consistency <= 35) return "sm";
  if (consistency <= 60) return "md";
  if (consistency <= 85) return "lg";
  return "xl";
}

/** Glow intensity for flame backgrounds (0-1 opacity) */
export function getFlameGlow(consistency: number): number {
  return Math.min(consistency / 100, 1) * 0.6;
}
