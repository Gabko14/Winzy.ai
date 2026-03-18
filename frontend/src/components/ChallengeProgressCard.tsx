import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Card, Badge } from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import type { ChallengeDetail, MilestoneType } from "../api/challenges";

type Props = {
  challenge: ChallengeDetail;
  /** Creator's display name (the friend who set the challenge) */
  creatorName?: string;
  /** When true, renders in a subdued past-challenge style (no encouragement, no active badges) */
  isPast?: boolean;
};

// --- Encouragement messages (aligned with VISION.md) ---

export type TrendIndicator = "onTrack" | "needsPush" | "almostThere" | "completed" | "starting" | "grace";

export function getTrendIndicator(challenge: ChallengeDetail): TrendIndicator {
  const progressPercent = getProgressPercent(challenge);
  const daysRemaining = getDaysRemaining(challenge);

  if (challenge.status === "completed" || challenge.status === "claimed") {
    return "completed";
  }
  if (progressPercent === 0) {
    return "starting";
  }
  if (daysRemaining <= 0 && challenge.status === "active") {
    return "grace";
  }
  if (progressPercent >= 90) {
    return "almostThere";
  }
  if (progressPercent >= 50) {
    return "onTrack";
  }
  return "needsPush";
}

export function getEncouragementMessage(trend: TrendIndicator): string {
  switch (trend) {
    case "onTrack":
      return "You're doing great! Keep it up!";
    case "needsPush":
      return "Every day counts. You've got this!";
    case "almostThere":
      return "So close! Just a little more!";
    case "completed":
      return "Challenge complete! Time to celebrate!";
    case "starting":
      return "A new challenge awaits. You've got this!";
    case "grace":
      return "Time's up, but every effort counts!";
  }
}

/**
 * Returns progress as a 0–100 percentage for display.
 * Backend returns progress as a 0.0–1.0 fraction (already normalized against targetValue).
 */
export function getProgressPercent(challenge: ChallengeDetail): number {
  const raw = challenge.progress * 100;
  if (Number.isNaN(raw)) return 0;
  return Math.min(Math.max(raw, 0), 100);
}

export function getDaysRemaining(challenge: ChallengeDetail): number {
  const now = new Date();
  const endsAt = new Date(challenge.endsAt);
  const diff = endsAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function getChallengeTitle(challenge: ChallengeDetail): string {
  const target = Math.round(challenge.targetValue);
  switch (challenge.milestoneType) {
    case "consistencyTarget":
      return `Reach ${target}% consistency`;
    case "daysInPeriod":
      return `Complete ${target} days in ${challenge.periodDays}-day period`;
    case "totalCompletions":
      return `Reach ${target} total completions`;
    case "customDateRange":
      return `Reach ${target}% in custom range`;
    case "improvementMilestone":
      return `Improve by ${target}%`;
    default:
      return "Challenge";
  }
}

function getMilestoneLabel(type: MilestoneType): string {
  switch (type) {
    case "consistencyTarget":
      return "Consistency";
    case "daysInPeriod":
      return "Days completed";
    case "totalCompletions":
      return "Total completions";
    case "customDateRange":
      return "Custom range";
    case "improvementMilestone":
      return "Improvement";
    default:
      return "Challenge";
  }
}

/**
 * Formats progress for display. Backend progress is a 0.0–1.0 fraction.
 * - Consistency-based types: show current% -> target% (derived from fraction * target)
 * - Count-based types: show completionCount / target
 */
function formatProgressValue(challenge: ChallengeDetail): string {
  const type = challenge.milestoneType;
  const progress = Number.isNaN(challenge.progress) ? 0 : (challenge.progress ?? 0);
  if (type === "consistencyTarget" || type === "customDateRange" || type === "improvementMilestone") {
    const currentValue = Math.round(progress * challenge.targetValue);
    return `${currentValue}% → ${Math.round(challenge.targetValue)}%`;
  }
  return `${challenge.completionCount} / ${Math.round(challenge.targetValue)}`;
}

export function ChallengeProgressCard({ challenge, creatorName, isPast }: Props) {
  const colors = lightTheme;
  const progressPercent = getProgressPercent(challenge);
  const daysRemaining = getDaysRemaining(challenge);
  const trend = getTrendIndicator(challenge);
  const encouragement = getEncouragementMessage(trend);

  const trendVariant: "success" | "warning" | "info" | "default" =
    trend === "onTrack" || trend === "completed"
      ? "success"
      : trend === "almostThere"
        ? "info"
        : trend === "needsPush"
          ? "warning"
          : "default";

  return (
    <View testID="challenge-progress-card">
    <Card style={{ ...styles.card, ...(isPast ? styles.pastCard : undefined) }}>
      {/* Header: title + milestone badge */}
      <View style={styles.header}>
        <Text
          style={[styles.title, { color: isPast ? colors.textSecondary : colors.textPrimary }]}
          testID="challenge-title"
          numberOfLines={2}
        >
          {getChallengeTitle(challenge)}
        </Text>
        <Badge
          label={getMilestoneLabel(challenge.milestoneType)}
          variant="default"
          testID="challenge-milestone-badge"
        />
      </View>

      {/* Creator info — shown prominently before reward for friend context */}
      {creatorName && (
        <Text
          style={[styles.creatorInfo, { color: colors.textTertiary }]}
          testID="challenge-creator"
        >
          Set by {creatorName}
        </Text>
      )}

      {/* Reward */}
      <Text
        style={[styles.reward, { color: colors.textSecondary }]}
        testID="challenge-reward"
        numberOfLines={2}
      >
        Reward: {challenge.rewardDescription}
      </Text>

      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressTrack, { backgroundColor: colors.backgroundSecondary }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: isPast ? colors.textTertiary : colors.brandPrimary,
                width: `${Math.min(progressPercent, 100)}%`,
              },
            ]}
            testID="challenge-progress-bar"
          />
        </View>
        <Text
          style={[styles.progressValue, { color: isPast ? colors.textTertiary : colors.brandPrimary }]}
          testID="challenge-progress-value"
        >
          {formatProgressValue(challenge)}
        </Text>
      </View>

      {/* Stats row: days remaining + trend */}
      <View style={styles.statsRow}>
        <Text
          style={[styles.daysRemaining, { color: colors.textSecondary }]}
          testID="challenge-days-remaining"
        >
          {isPast
            ? "Ended"
            : daysRemaining === 0
              ? "Time's up"
              : `${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining`}
        </Text>
        {!isPast && (
          <Badge
            label={trend === "onTrack" ? "On track" : trend === "needsPush" ? "Room to grow" : trend === "almostThere" ? "Almost there" : trend === "completed" ? "Completed" : trend === "starting" ? "Just started" : "Grace period"}
            variant={trendVariant}
            testID="challenge-trend-badge"
          />
        )}
      </View>

      {/* Encouragement — hidden for past challenges */}
      {!isPast && (
        <Text
          style={[styles.encouragement, { color: colors.textSecondary }]}
          testID="challenge-encouragement"
        >
          {encouragement}
        </Text>
      )}
    </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  pastCard: {
    opacity: 0.7,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    fontWeight: "600",
    flex: 1,
  },
  reward: {
    ...typography.bodySmall,
    marginBottom: spacing.md,
  },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  progressTrack: {
    flex: 1,
    height: 8,
    borderRadius: radii.full,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radii.full,
  },
  progressValue: {
    ...typography.bodySmall,
    fontWeight: "600",
    minWidth: 80,
    textAlign: "right",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  daysRemaining: {
    ...typography.bodySmall,
  },
  creatorInfo: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  encouragement: {
    ...typography.bodySmall,
    fontStyle: "italic",
  },
});
