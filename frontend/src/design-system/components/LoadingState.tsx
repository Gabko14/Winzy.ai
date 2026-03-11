import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { spacing } from "../tokens/spacing";
import { typography } from "../tokens/typography";
import { lightTheme } from "../tokens/colors";

export type LoadingStateProps = {
  message?: string;
};

export function LoadingState({ message }: LoadingStateProps) {
  const colors = lightTheme;

  return (
    <View style={styles.container} testID="loading-state">
      <ActivityIndicator size="large" color={colors.brandPrimary} />
      {message && <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["2xl"],
    gap: spacing.base,
  },
  message: {
    ...typography.body,
    textAlign: "center",
  },
});
