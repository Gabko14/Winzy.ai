import type { FlameLevel } from "../design-system";

export function flameLevelFromConsistency(consistency: number): FlameLevel {
  if (consistency >= 80) return "blazing";
  if (consistency >= 55) return "strong";
  if (consistency >= 30) return "steady";
  if (consistency >= 10) return "ember";
  return "none";
}

export function flameBackgroundColor(level: FlameLevel): string {
  switch (level) {
    case "blazing": return "#FEE2E2";
    case "strong": return "#FFEDD5";
    case "steady": return "#FFF7ED";
    case "ember": return "#FEF3C7";
    case "none":
    default: return "#F5F5F4";
  }
}

export function flameTextColor(level: FlameLevel): string {
  switch (level) {
    case "blazing": return "#DC2626";
    case "strong": return "#F97316";
    case "steady": return "#EA580C";
    case "ember": return "#D97706";
    case "none":
    default: return "#78716C";
  }
}
