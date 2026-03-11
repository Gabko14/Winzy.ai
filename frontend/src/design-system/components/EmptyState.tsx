import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { spacing } from "../tokens/spacing";
import { typography } from "../tokens/typography";
import { lightTheme } from "../tokens/colors";
import { Button } from "./Button";
import { FadeIn } from "./FadeIn";
import { Flame } from "./Flame";

export type EmptyStateProps = {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Hide the default illustration. */
  hideIllustration?: boolean;
};

export function EmptyState({ title, message, actionLabel, onAction, hideIllustration = false }: EmptyStateProps) {
  const colors = lightTheme;

  return (
    <FadeIn>
      <View style={styles.container} accessibilityRole="text">
        {!hideIllustration && (
          <View style={styles.illustration} testID="empty-state-illustration">
            <Flame flameLevel="none" size="lg" />
          </View>
        )}
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {message && <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>}
        {actionLabel && onAction && (
          <View style={styles.action}>
            <Button title={actionLabel} onPress={onAction} variant="secondary" size="sm" />
          </View>
        )}
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["2xl"],
    gap: spacing.sm,
  },
  illustration: {
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h4,
    textAlign: "center",
  },
  message: {
    ...typography.body,
    textAlign: "center",
  },
  action: {
    marginTop: spacing.base,
  },
});
