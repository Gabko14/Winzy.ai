import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { TextInput } from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { codePointLength } from "../utils/validation";

export const MIN_TARGET = 1;
export const MAX_TARGET = 100;
export const MIN_PERIOD = 7;
export const MAX_PERIOD = 365;
export const DEFAULT_TARGET = 60;
export const DEFAULT_PERIOD = 30;
export const MAX_REWARD_LENGTH = 512;

export const PERIOD_PRESETS = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
] as const;

export const REWARD_EXAMPLES = [
  "Grab coffee at that new place downtown",
  "Play a round of tennis together",
  "Cook dinner together and try a new recipe",
  "Go for a sunset bike ride",
] as const;

export function rewardCharCount(value: string): number {
  return codePointLength(value.trim());
}

export function isRewardValid(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return rewardCharCount(value) <= MAX_REWARD_LENGTH;
}

export function isTargetPeriodValid(targetValue: number, periodDays: number): boolean {
  return (
    targetValue >= MIN_TARGET &&
    targetValue <= MAX_TARGET &&
    periodDays >= MIN_PERIOD &&
    periodDays <= MAX_PERIOD
  );
}

type TargetPeriodProps = {
  targetValue: number;
  periodDays: number;
  onTargetChange: (value: number) => void;
  onPeriodChange: (days: number) => void;
  goalHintName?: string;
};

export function ChallengeTargetPeriodFields({
  targetValue,
  periodDays,
  onTargetChange,
  onPeriodChange,
  goalHintName,
}: TargetPeriodProps) {
  const colors = lightTheme;

  return (
    <View testID="challenge-target-period-fields">
      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>
          Target consistency
        </Text>
        <View style={styles.sliderRow}>
          <Pressable
            onPress={() => onTargetChange(Math.max(MIN_TARGET, targetValue - 5))}
            style={[styles.sliderButton, { borderColor: colors.border }]}
            accessibilityLabel={`Decrease target, currently ${targetValue}%`}
            testID="target-decrease"
          >
            <Text style={[styles.sliderButtonText, { color: colors.textPrimary }]}>-</Text>
          </Pressable>
          <View style={styles.sliderValue}>
            <Text style={[styles.targetValueText, { color: colors.brandPrimary }]} testID="target-value">
              {targetValue}%
            </Text>
          </View>
          <Pressable
            onPress={() => onTargetChange(Math.min(MAX_TARGET, targetValue + 5))}
            style={[styles.sliderButton, { borderColor: colors.border }]}
            accessibilityLabel={`Increase target, currently ${targetValue}%`}
            testID="target-increase"
          >
            <Text style={[styles.sliderButtonText, { color: colors.textPrimary }]}>+</Text>
          </Pressable>
        </View>
        <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
          {targetValue <= 30
            ? "A gentle start - great for building momentum!"
            : targetValue <= 60
              ? "A solid goal - challenging but achievable!"
              : targetValue <= 80
                ? "Ambitious! This will take real commitment."
                : "Going for the top - impressive dedication!"}
          {goalHintName ? ` (${goalHintName})` : ""}
        </Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>
          Time period
        </Text>
        <View style={styles.presetRow} testID="period-presets">
          {PERIOD_PRESETS.map((preset) => (
            <Pressable
              key={preset.days}
              onPress={() => onPeriodChange(preset.days)}
              style={[
                styles.presetChip,
                {
                  backgroundColor: periodDays === preset.days ? colors.brandPrimary : colors.surface,
                  borderColor: periodDays === preset.days ? colors.brandPrimary : colors.border,
                },
              ]}
              accessibilityLabel={`${preset.label} period`}
              accessibilityState={{ selected: periodDays === preset.days }}
              testID={`period-${preset.days}`}
            >
              <Text
                style={[
                  styles.presetChipText,
                  {
                    color: periodDays === preset.days ? colors.textInverse : colors.textPrimary,
                  },
                ]}
              >
                {preset.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

type RewardProps = {
  value: string;
  onChange: (value: string) => void;
};

export function ChallengeRewardFields({ value, onChange }: RewardProps) {
  const colors = lightTheme;
  const chars = rewardCharCount(value);
  const tooLong = chars > MAX_REWARD_LENGTH;

  return (
    <View testID="challenge-reward-fields">
      <View style={styles.fieldGroup}>
        <TextInput
          label="Shared experience"
          placeholder={'e.g., "We\'ll go hiking at our favorite trail"'}
          value={value}
          onChangeText={onChange}
          multiline
          numberOfLines={3}
          maxLength={MAX_REWARD_LENGTH}
          validationState={tooLong ? "error" : "default"}
          errorMessage={tooLong ? `Maximum ${MAX_REWARD_LENGTH} characters` : undefined}
          hint={`${chars}/${MAX_REWARD_LENGTH} characters`}
          testID="reward-input"
          accessibilityLabel="Describe the shared experience reward"
        />
      </View>

      <View style={styles.rewardExamples}>
        <Text style={[styles.examplesLabel, { color: colors.textTertiary }]}>
          IDEAS
        </Text>
        {REWARD_EXAMPLES.map((example) => (
          <Pressable
            key={example}
            onPress={() => onChange(example)}
            style={[styles.exampleChip, { backgroundColor: colors.backgroundSecondary }]}
            accessibilityLabel={`Use suggestion: ${example}`}
          >
            <Text style={[styles.exampleText, { color: colors.textSecondary }]}>
              {example}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: {
    marginBottom: spacing.xl,
  },
  fieldLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  fieldHint: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.base,
  },
  sliderButton: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sliderButtonText: {
    fontSize: 22,
    fontWeight: "600",
  },
  sliderValue: {
    flex: 1,
    alignItems: "center",
  },
  targetValueText: {
    ...typography.h1,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  presetChip: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  presetChipText: {
    ...typography.label,
  },
  rewardExamples: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  examplesLabel: {
    ...typography.label,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  exampleChip: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  exampleText: {
    ...typography.bodySmall,
  },
});
