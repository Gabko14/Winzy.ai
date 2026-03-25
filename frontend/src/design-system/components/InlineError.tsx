import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { spacing, radii } from "../tokens/spacing";
import { typography } from "../tokens/typography";
import { lightTheme } from "../tokens/colors";

export type InlineErrorProps = {
  message: string;
  testID?: string;
};

/**
 * Inline error banner for form validation and server errors.
 * Renders a colored banner with error text and alert role.
 */
export function InlineError({ message, testID }: InlineErrorProps) {
  const colors = lightTheme;

  return (
    <View
      style={[styles.banner, { backgroundColor: colors.errorBackground }]}
      accessibilityRole="alert"
      testID={testID}
    >
      <Text style={[styles.text, { color: colors.error }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.base,
  },
  text: {
    ...typography.bodySmall,
    fontWeight: "500",
  },
});
