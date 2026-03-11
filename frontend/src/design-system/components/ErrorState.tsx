import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { spacing, radii } from "../tokens/spacing";
import { typography } from "../tokens/typography";
import { lightTheme } from "../tokens/colors";
import { Button } from "./Button";

export type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({ title = "Something went wrong", message, onRetry }: ErrorStateProps) {
  const colors = lightTheme;

  return (
    <View
      style={[styles.container, { backgroundColor: colors.errorBackground }]}
      accessibilityRole="alert"
    >
      <Text style={[styles.title, { color: colors.error }]}>{title}</Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
      {onRetry && (
        <View style={styles.action}>
          <Button title="Try again" onPress={onRetry} variant="secondary" size="sm" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["2xl"],
    gap: spacing.sm,
    borderRadius: radii.lg,
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
