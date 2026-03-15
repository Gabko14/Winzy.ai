import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Modal, Button, AnimatedCheckmark, Badge } from "../design-system";
import { spacing, typography, lightTheme } from "../design-system";
import type { ChallengeDetail } from "../api/challenges";
import type { ApiError } from "../api/types";
import { getChallengeTitle } from "./ChallengeProgressCard";

type Props = {
  challenge: ChallengeDetail;
  claiming: boolean;
  claimError: ApiError | null;
  remainingCount: number;
  onClaim: () => void;
  onDismiss: () => void;
};

export function ChallengeCompletionOverlay({
  challenge,
  claiming,
  claimError,
  remainingCount,
  onClaim,
  onDismiss,
}: Props) {
  const colors = lightTheme;

  return (
    <Modal visible onClose={onDismiss}>
      <View style={styles.content} testID="challenge-completion-overlay">
        <AnimatedCheckmark visible size={64} />

        <Text
          style={[styles.heading, { color: colors.textPrimary }]}
          testID="celebration-heading"
        >
          Challenge Complete!
        </Text>

        <Text
          style={[styles.challengeTitle, { color: colors.brandPrimary }]}
          testID="celebration-challenge-title"
        >
          {getChallengeTitle(challenge)}
        </Text>

        {challenge.rewardDescription ? (
          <View
            style={[styles.rewardCard, { backgroundColor: colors.backgroundSecondary }]}
            testID="celebration-reward"
          >
            <Text style={[styles.rewardLabel, { color: colors.textSecondary }]}>
              Time to celebrate together
            </Text>
            <Text style={[styles.rewardDescription, { color: colors.textPrimary }]}>
              {challenge.rewardDescription}
            </Text>
          </View>
        ) : (
          <View
            style={[styles.rewardCard, { backgroundColor: colors.backgroundSecondary }]}
            testID="celebration-reward-generic"
          >
            <Text style={[styles.rewardDescription, { color: colors.textPrimary }]}>
              You did it! Your consistency paid off.
            </Text>
          </View>
        )}

        {claimError && (
          <Text
            style={[styles.errorText, { color: colors.error }]}
            testID="celebration-claim-error"
          >
            Could not claim reward. Tap to try again.
          </Text>
        )}

        <View style={styles.actions}>
          <Button
            title={claimError ? "Retry Claim" : claiming ? "Claiming..." : "Claim Reward"}
            onPress={onClaim}
            disabled={claiming}
            size="lg"
          />
          <Button
            title="Later"
            onPress={onDismiss}
            variant="ghost"
            size="md"
          />
        </View>

        {remainingCount > 0 && (
          <Badge
            label={`${remainingCount} more challenge${remainingCount !== 1 ? "s" : ""} completed`}
            variant="info"
            testID="celebration-remaining-badge"
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    gap: spacing.base,
    paddingTop: spacing.md,
  },
  heading: {
    ...typography.h2,
    textAlign: "center",
  },
  challengeTitle: {
    ...typography.h4,
    textAlign: "center",
  },
  rewardCard: {
    width: "100%",
    padding: spacing.lg,
    borderRadius: 12,
    alignItems: "center",
    gap: spacing.sm,
  },
  rewardLabel: {
    ...typography.bodySmall,
  },
  rewardDescription: {
    ...typography.body,
    textAlign: "center",
    fontWeight: "600",
  },
  errorText: {
    ...typography.bodySmall,
    textAlign: "center",
  },
  actions: {
    width: "100%",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
