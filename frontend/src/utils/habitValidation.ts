/**
 * Habit-specific validation matching backend rules.
 *
 * Keep in sync with:
 *   services/habit-service/src/Program.cs (CreateHabitRequest validation)
 */

import type { FieldError } from "./validation";
import type { FrequencyType } from "../api/habits";

const NAME_MAX = 256;

export function validateHabitName(name: string): FieldError {
  const trimmed = name.trim();
  if (!trimmed) return "Habit name is required.";
  if (trimmed.length > NAME_MAX) return `Name must not exceed ${NAME_MAX} characters.`;
  return null;
}

export function validateCustomDays(frequency: FrequencyType, customDays: number[]): FieldError {
  if (frequency === "custom" && customDays.length === 0) {
    return "Select at least one day for custom frequency.";
  }
  return null;
}
