import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Modal, Flame, Button } from "../design-system";
import { spacing, typography, lightTheme } from "../design-system";

type Props = {
  visible: boolean;
  onDismiss: () => void;
};

export function FlameIntroModal({ visible, onDismiss }: Props) {
  const colors = lightTheme;

  return (
    <Modal visible={visible} onClose={onDismiss} title="Meet your Flame">
      <View style={styles.content} testID="flame-intro-modal">
        <View style={styles.flameRow}>
          <View style={styles.flameExample}>
            <Flame flameLevel="ember" size="sm" />
            <Text style={[styles.flameLabel, { color: colors.textSecondary }]}>Starting</Text>
          </View>
          <View style={styles.flameExample}>
            <Flame flameLevel="steady" size="sm" />
            <Text style={[styles.flameLabel, { color: colors.textSecondary }]}>Steady</Text>
          </View>
          <View style={styles.flameExample}>
            <Flame flameLevel="blazing" size="sm" />
            <Text style={[styles.flameLabel, { color: colors.textSecondary }]}>Blazing</Text>
          </View>
        </View>

        <Text style={[styles.description, { color: colors.textPrimary }]}>
          Your Flame reflects your consistency over the last 60 days. Log habits regularly and watch it grow brighter.
        </Text>

        <Text style={[styles.encouragement, { color: colors.textSecondary }]}>
          Missing a day won't reset your progress. Just keep going.
        </Text>

        <View style={styles.action}>
          <Button title="Got it" onPress={onDismiss} size="md" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    gap: spacing.base,
  },
  flameRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing["2xl"],
    paddingVertical: spacing.base,
  },
  flameExample: {
    alignItems: "center",
    gap: spacing.sm,
  },
  flameLabel: {
    ...typography.caption,
  },
  description: {
    ...typography.body,
    textAlign: "center",
  },
  encouragement: {
    ...typography.bodySmall,
    textAlign: "center",
    fontStyle: "italic",
  },
  action: {
    width: "100%",
    marginTop: spacing.sm,
  },
});
