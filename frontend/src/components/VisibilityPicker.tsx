import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { spacing, radii, typography, lightTheme } from "../design-system";
import type { HabitVisibility } from "../api/visibility";

type VisibilityOption = {
  value: HabitVisibility;
  label: string;
  description: string;
};

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  { value: "private", label: "Private", description: "Only you" },
  { value: "friends", label: "Friends", description: "Approved friends" },
  { value: "public", label: "Public", description: "Anyone with link" },
];

export type VisibilityPickerProps = {
  value: HabitVisibility;
  onChange: (value: HabitVisibility) => void;
  disabled?: boolean;
};

export function VisibilityPicker({ value, onChange, disabled }: VisibilityPickerProps) {
  const colors = lightTheme;

  return (
    <View style={styles.section} testID="visibility-picker">
      <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>Visibility</Text>
      <View style={styles.optionsRow}>
        {VISIBILITY_OPTIONS.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => {
                if (!disabled) onChange(opt.value);
              }}
              disabled={disabled}
              style={[
                styles.option,
                {
                  backgroundColor: isSelected ? colors.brandPrimary : colors.backgroundSecondary,
                  borderColor: isSelected ? colors.brandPrimary : colors.border,
                  opacity: disabled ? 0.5 : 1,
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled }}
              accessibilityLabel={`${opt.label}: ${opt.description}`}
              testID={`visibility-${opt.value}`}
            >
              <Text
                style={[
                  styles.optionLabel,
                  { color: isSelected ? colors.textInverse : colors.textPrimary },
                ]}
              >
                {opt.label}
              </Text>
              <Text
                style={[
                  styles.optionDescription,
                  { color: isSelected ? colors.textInverse : colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {opt.description}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Returns a human-readable label for a visibility value.
 */
export function visibilityLabel(visibility: HabitVisibility): string {
  return VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.label ?? "Private";
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
  },
  sectionLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  optionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  option: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
  },
  optionLabel: {
    ...typography.label,
    marginBottom: 2,
  },
  optionDescription: {
    ...typography.caption,
    fontSize: 10,
  },
});
