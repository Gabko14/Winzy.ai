import React from "react";
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { spacing } from "../tokens/spacing";
import { typography } from "../tokens/typography";
import { lightTheme } from "../tokens/colors";

export type ScreenHeaderProps = {
  title: string;
  onBack?: () => void;
  testID?: string;
  backTestID?: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Shared header with optional back button and title.
 * Matches the pattern used across overlay screens.
 */
export function ScreenHeader({ title, onBack, testID, backTestID = "back-button", right, style }: ScreenHeaderProps) {
  const colors = lightTheme;

  return (
    <View style={[styles.header, style]} testID={testID}>
      {onBack && (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
          testID={backTestID}
        >
          <Text style={[styles.backText, { color: colors.brandPrimary }]}>{"\u2190"}</Text>
        </Pressable>
      )}
      <Text
        style={[styles.headerTitle, { color: colors.textPrimary }]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  backButton: {
    padding: spacing.xs,
  },
  backText: {
    fontSize: 24,
  },
  headerTitle: {
    ...typography.h2,
    flex: 1,
  },
});
