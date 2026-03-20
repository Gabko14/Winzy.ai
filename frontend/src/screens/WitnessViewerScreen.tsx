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
} from "../design-system";
import { fetchWitnessView, type WitnessViewResponse } from "../api/witnessLinks";
import { flameLevelFromConsistency, flameBackgroundColor, flameTextColor } from "../utils/flameHelpers";

type Props = {
  token: string;
  onNavigateToSignUp?: () => void;
};

export function WitnessViewerScreen({ token, onNavigateToSignUp }: Props) {
  const colors = lightTheme;
  const [data, setData] = useState<WitnessViewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);

  const fetchData = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    setNotAvailable(false);

    try {
      const result = await fetchWitnessView(token);
      if (signal?.cancelled) return;
      setData(result);
    } catch (err: unknown) {
      if (signal?.cancelled) return;
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "not_found"
      ) {
        setNotAvailable(true);
      } else {
        setError("Could not load this page. Please try again.");
      }
    } finally {
      if (!signal?.cancelled) {
        setLoading(false);
      }
    }
  }, [token]);

  useEffect(() => {
    const signal = { cancelled: false };
    fetchData(signal);
    return () => { signal.cancelled = true; };
  }, [fetchData]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="witness-viewer-loading">
        <LoadingState message="Loading..." />
      </View>
    );
  }

  if (notAvailable) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="witness-viewer-not-available">
        <EmptyState
          title="This link is not available"
          message="It may have been revoked or is no longer active."
          actionLabel="Create your own flame"
          onAction={onNavigateToSignUp}
        />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="witness-viewer-error">
        <ErrorState message={error} onRetry={fetchData} />
      </View>
    );
  }

  if (!data) return null;

  const ownerName = data.ownerDisplayName || (data.ownerUsername ? `@${data.ownerUsername}` : "Someone");

  const aggregateConsistency =
    data.habits.length > 0
      ? data.habits.reduce((sum, h) => sum + h.consistency, 0) / data.habits.length
      : 0;

  const aggregateFlameLevel = flameLevelFromConsistency(aggregateConsistency);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.scrollContent}
      testID="witness-viewer-screen"
    >
      {/* Hero section */}
      <View style={[styles.hero, { backgroundColor: colors.surface }]}>
        <View style={styles.heroFlame}>
          <Flame flameLevel={aggregateFlameLevel} size="lg" consistency={aggregateConsistency} />
        </View>
        <Text style={[styles.ownerName, { color: colors.textPrimary }]} testID="witness-owner-name">
          {ownerName}
        </Text>
        {data.habits.length > 0 && (
          <Text style={[styles.consistencyLabel, { color: colors.textSecondary }]}>
            {Math.round(aggregateConsistency)}% consistency
          </Text>
        )}
        <Text style={[styles.supportiveCopy, { color: colors.textTertiary }]}>
          is building better habits
        </Text>
      </View>

      {/* Habits list */}
      {data.habitsUnavailable && data.habits.length === 0 ? (
        <View style={styles.emptySection} testID="witness-viewer-degraded">
          <ErrorState
            title="Temporarily unavailable"
            message="We're having trouble loading habit data right now. Please try again shortly."
            onRetry={fetchData}
          />
        </View>
      ) : data.habits.length === 0 ? (
        <View style={styles.emptySection} testID="witness-viewer-empty">
          <EmptyState
            title="No habits shared yet"
            message={`${ownerName} hasn't selected any habits for this link yet.`}
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
                    { backgroundColor: flameBackgroundColor(habit.flameLevel) },
                  ]}
                >
                  <Text
                    style={[styles.flameBadgeText, { color: flameTextColor(habit.flameLevel) }]}
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
          Build consistency, watch your flame grow, and share your progress with the people who matter.
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
  ownerName: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  consistencyLabel: {
    ...typography.bodyLarge,
    marginBottom: spacing.xs,
  },
  supportiveCopy: {
    ...typography.bodySmall,
    fontStyle: "italic",
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
