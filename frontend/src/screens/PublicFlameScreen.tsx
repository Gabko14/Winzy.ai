import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import {
  Flame,
  Card,
  Button,
  LoadingState,
  ErrorState,
  EmptyState,
  spacing,
  radii,
  typography,
  lightTheme,
  brand,
  shadows,
  type FlameLevel,
} from "../design-system";
import { apiRequest } from "../api";

type PublicHabit = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  consistency: number;
  flameLevel: FlameLevel;
};

type PublicFlameResponse = {
  username: string;
  habits: PublicHabit[];
  degraded: boolean;
};

type Props = {
  username: string;
  onNavigateToSignUp?: () => void;
};

export function PublicFlameScreen({ username, onNavigateToSignUp }: Props) {
  const colors = lightTheme;
  const [data, setData] = useState<PublicFlameResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const result = await apiRequest<PublicFlameResponse>(
        `/habits/public/${encodeURIComponent(username)}`,
        { noAuth: true },
      );
      setData(result);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "not_found"
      ) {
        setNotFound(true);
      } else {
        setError("Could not load this profile. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="public-flame-loading">
        <LoadingState message="Loading profile..." />
      </View>
    );
  }

  if (notFound) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="public-flame-not-found">
        <EmptyState
          title="User not found"
          message={`We couldn't find anyone with the username @${username}.`}
          actionLabel="Create your own flame"
          onAction={onNavigateToSignUp}
        />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="public-flame-error">
        <ErrorState message={error} onRetry={fetchProfile} />
      </View>
    );
  }

  if (!data) return null;

  const aggregateConsistency =
    data.habits.length > 0
      ? data.habits.reduce((sum, h) => sum + h.consistency, 0) / data.habits.length
      : 0;

  const aggregateFlameLevel = getAggregateFlameLevelFromConsistency(aggregateConsistency);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.scrollContent}
      testID="public-flame-screen"
    >
      {/* Hero section */}
      <View style={[styles.hero, { backgroundColor: colors.surface }]}>
        <View style={styles.heroFlame}>
          <Flame flameLevel={aggregateFlameLevel} size="lg" consistency={aggregateConsistency} />
        </View>
        <Text style={[styles.username, { color: colors.textPrimary }]}>@{data.username}</Text>
        <Text style={[styles.consistencyLabel, { color: colors.textSecondary }]}>
          {Math.round(aggregateConsistency)}% consistency
        </Text>
        {data.habits.length > 0 && (
          <Text style={[styles.habitCount, { color: colors.textTertiary }]}>
            {data.habits.length} {data.habits.length === 1 ? "habit" : "habits"}
          </Text>
        )}
      </View>

      {/* Habits list */}
      {data.degraded && data.habits.length === 0 ? (
        <View style={styles.emptySection} testID="public-flame-degraded">
          <ErrorState
            title="Temporarily unavailable"
            message={`We're having trouble loading @${data.username}'s habits right now. Please try again shortly.`}
            onRetry={fetchProfile}
          />
        </View>
      ) : data.habits.length === 0 ? (
        <View style={styles.emptySection}>
          <EmptyState
            title="No public habits yet"
            message={`@${data.username} hasn't shared any habits publicly.`}
          />
        </View>
      ) : (
        <View style={styles.habitsSection}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Habits</Text>
          {data.habits.map((habit) => (
            <Card key={habit.id} style={styles.habitCard}>
              <View style={styles.habitRow}>
                <View style={styles.habitFlame}>
                  <Flame flameLevel={habit.flameLevel} size="sm" consistency={habit.consistency} />
                </View>
                <View style={styles.habitInfo}>
                  <Text style={[styles.habitName, { color: colors.textPrimary }]}>
                    {habit.icon ? `${habit.icon} ` : ""}
                    {habit.name}
                  </Text>
                  <Text style={[styles.habitConsistency, { color: colors.textSecondary }]}>
                    {Math.round(habit.consistency)}% consistency
                  </Text>
                </View>
                <View
                  style={[
                    styles.flameBadge,
                    { backgroundColor: getFlameBackgroundColor(habit.flameLevel) },
                  ]}
                >
                  <Text
                    style={[styles.flameBadgeText, { color: getFlameTextColor(habit.flameLevel) }]}
                  >
                    {habit.flameLevel}
                  </Text>
                </View>
              </View>
            </Card>
          ))}
        </View>
      )}

      {/* CTA section */}
      <View style={[styles.ctaSection, { backgroundColor: brand.flame50 }]}>
        <Text style={[styles.ctaTitle, { color: colors.textPrimary }]}>
          Track your own habits
        </Text>
        <Text style={[styles.ctaMessage, { color: colors.textSecondary }]}>
          Build consistency, watch your flame grow, and share your progress.
        </Text>
        <View style={styles.ctaButton}>
          <Button
            title="Get started"
            onPress={onNavigateToSignUp ?? (() => {})}
            size="lg"
          />
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textTertiary }]}>
          Powered by Winzy.ai
        </Text>
      </View>
    </ScrollView>
  );
}

function getAggregateFlameLevelFromConsistency(consistency: number): FlameLevel {
  if (consistency >= 80) return "blazing";
  if (consistency >= 55) return "strong";
  if (consistency >= 30) return "steady";
  if (consistency >= 10) return "ember";
  return "none";
}

function getFlameBackgroundColor(level: FlameLevel): string {
  switch (level) {
    case "blazing":
      return "#FEE2E2";
    case "strong":
      return "#FFEDD5";
    case "steady":
      return "#FFF7ED";
    case "ember":
      return "#FEF3C7";
    case "none":
    default:
      return "#F5F5F4";
  }
}

function getFlameTextColor(level: FlameLevel): string {
  switch (level) {
    case "blazing":
      return "#DC2626";
    case "strong":
      return "#F97316";
    case "steady":
      return "#EA580C";
    case "ember":
      return "#D97706";
    case "none":
    default:
      return "#78716C";
  }
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
  },
  scrollContent: {
    paddingBottom: spacing["3xl"],
  },
  hero: {
    alignItems: "center",
    paddingTop: spacing["4xl"],
    paddingBottom: spacing["2xl"],
    paddingHorizontal: spacing["3xl"],
    ...shadows.sm,
  },
  heroFlame: {
    marginBottom: spacing.base,
  },
  username: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  consistencyLabel: {
    ...typography.bodyLarge,
    marginBottom: spacing.xs,
  },
  habitCount: {
    ...typography.bodySmall,
  },
  emptySection: {
    paddingTop: spacing["2xl"],
  },
  habitsSection: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.h4,
    marginBottom: spacing.sm,
  },
  habitCard: {
    marginBottom: spacing.sm,
  },
  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  habitFlame: {
    width: 32,
    alignItems: "center",
  },
  habitInfo: {
    flex: 1,
  },
  habitName: {
    ...typography.body,
    fontWeight: "600",
  },
  habitConsistency: {
    ...typography.bodySmall,
  },
  flameBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  flameBadgeText: {
    ...typography.caption,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  ctaSection: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    padding: spacing["2xl"],
    borderRadius: radii.lg,
    alignItems: "center",
  },
  ctaTitle: {
    ...typography.h4,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  ctaMessage: {
    ...typography.body,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  ctaButton: {
    width: "100%",
    maxWidth: 280,
  },
  footer: {
    alignItems: "center",
    paddingTop: spacing["2xl"],
    paddingBottom: spacing.base,
  },
  footerText: {
    ...typography.caption,
  },
});
