import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { ErrorState, LoadingState } from "../design-system";
import { spacing, typography, lightTheme } from "../design-system";
import { useHabitChallenges } from "../hooks/useChallenges";
import { ChallengeProgressCard } from "./ChallengeProgressCard";

type Props = {
  habitId: string;
};

export function ActiveChallengesSection({ habitId }: Props) {
  const colors = lightTheme;
  const { challenges, loading, error, refresh } = useHabitChallenges(habitId);

  // Don't show the section at all if there are no challenges and we're not loading
  if (!loading && !error && challenges.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} testID="active-challenges-section">
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
        Active Challenges
      </Text>

      {loading && (
        <LoadingState message="Loading challenges..." />
      )}

      {error && !loading && (
        <ErrorState message={error.message} onRetry={refresh} />
      )}

      {!loading && !error && challenges.map((challenge) => (
        <ChallengeProgressCard
          key={challenge.id}
          challenge={challenge}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.base,
  },
  sectionTitle: {
    ...typography.h4,
    marginBottom: spacing.md,
  },
});
