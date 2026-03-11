import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { spacing } from "../tokens/spacing";
import { typography } from "../tokens/typography";
import { lightTheme } from "../tokens/colors";
import { SkeletonLoader } from "./SkeletonLoader";
import { FadeIn } from "./FadeIn";

export type LoadingStateProps = {
  message?: string;
  /** Use skeleton loaders instead of a spinner. Default false. */
  skeleton?: boolean;
  /** Number of skeleton rows to show. Default 3. */
  skeletonRows?: number;
};

export function LoadingState({ message, skeleton = false, skeletonRows = 3 }: LoadingStateProps) {
  const colors = lightTheme;

  if (skeleton) {
    return (
      <FadeIn>
        <View style={styles.container} testID="loading-state">
          <View style={styles.skeletonGroup}>
            {Array.from({ length: skeletonRows }).map((_, i) => (
              <View key={i} style={styles.skeletonRow}>
                <SkeletonLoader width={40} height={40} circle />
                <View style={styles.skeletonLines}>
                  <SkeletonLoader width="70%" height={14} />
                  <SkeletonLoader width="90%" height={10} />
                </View>
              </View>
            ))}
          </View>
          {message && <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>}
        </View>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <View style={styles.container} testID="loading-state">
        <ActivityIndicator size="large" color={colors.brandPrimary} />
        {message && <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>}
      </View>
    </FadeIn>
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
  skeletonGroup: {
    width: "100%",
    gap: spacing.base,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  skeletonLines: {
    flex: 1,
    gap: spacing.sm,
  },
});
