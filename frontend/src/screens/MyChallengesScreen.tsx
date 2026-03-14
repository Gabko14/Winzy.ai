import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { LoadingState, ErrorState, EmptyState } from "../design-system";
import { spacing, typography, lightTheme } from "../design-system";
import { fetchChallenges, fetchChallengeDetail, type ChallengeDetail } from "../api/challenges";
import type { ApiError } from "../api/types";
import { ChallengeProgressCard } from "../components/ChallengeProgressCard";

type Props = {
  onBack?: () => void;
};

export function MyChallengesScreen({ onBack }: Props) {
  const colors = lightTheme;
  const [challenges, setChallenges] = useState<ChallengeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO(winzy.ai-n+1): N+1 API calls — fetches list then detail for each.
      // Fix by adding progress fields to the list endpoint response.
      const page = await fetchChallenges(1, 100);
      const details = await Promise.all(
        page.items.map((c) => fetchChallengeDetail(c.id)),
      );
      setChallenges(details);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeChallenges = challenges.filter((c) => c.status === "active");
  const completedChallenges = challenges.filter(
    (c) => c.status === "completed" || c.status === "claimed",
  );
  const expiredChallenges = challenges.filter(
    (c) => c.status === "expired" || c.status === "cancelled",
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="challenges-loading">
        <LoadingState message="Loading your challenges..." />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="challenges-error">
        <ErrorState message={error.message} onRetry={load} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.scrollContent}
      testID="my-challenges-screen"
    >
      <View style={styles.header}>
        {onBack && (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backButton}
            testID="back-button"
          >
            <Text style={[styles.backText, { color: colors.brandPrimary }]}>{"\u2190"}</Text>
          </Pressable>
        )}
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>My Challenges</Text>
      </View>

      {challenges.length === 0 && (
        <EmptyState
          title="No challenges yet"
          message="When a friend sets a challenge for you, it will appear here."
          hideIllustration
        />
      )}

      {/* Active challenges */}
      {activeChallenges.length > 0 && (
        <View testID="active-challenges-list">
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            Active
          </Text>
          {activeChallenges.map((challenge) => (
            <ChallengeProgressCard key={challenge.id} challenge={challenge} />
          ))}
        </View>
      )}

      {/* Completed challenges */}
      {completedChallenges.length > 0 && (
        <View testID="completed-challenges-list">
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            Completed
          </Text>
          {completedChallenges.map((challenge) => (
            <ChallengeProgressCard key={challenge.id} challenge={challenge} />
          ))}
        </View>
      )}

      {/* Past challenges */}
      {expiredChallenges.length > 0 && (
        <View testID="expired-challenges-list">
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            Past
          </Text>
          {expiredChallenges.map((challenge) => (
            <ChallengeProgressCard key={challenge.id} challenge={challenge} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.base,
    paddingBottom: spacing["4xl"],
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
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
  sectionTitle: {
    ...typography.h4,
    marginBottom: spacing.md,
    marginTop: spacing.md,
  },
});
