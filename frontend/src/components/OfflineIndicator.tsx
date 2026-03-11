import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { spacing } from "../design-system/tokens/spacing";
import { typography } from "../design-system/tokens/typography";
import { semantic } from "../design-system/tokens/colors";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

/**
 * Subtle banner shown at the top of the screen when the device is offline.
 * Encouraging tone: "You're offline — we'll sync when you're back."
 */
export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <View style={styles.container} accessibilityRole="alert" testID="offline-indicator">
      <Text style={styles.text}>{"You\u2019re offline \u2014 we\u2019ll sync when you\u2019re back"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: semantic.warningLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    alignItems: "center",
  },
  text: {
    ...typography.caption,
    color: semantic.warning,
    fontWeight: "600",
  },
});
