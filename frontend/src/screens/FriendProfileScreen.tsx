import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl } from "react-native";
import {
  Card,
  Flame,
  LoadingState,
  ErrorState,
  EmptyState,
  Button,
  Avatar,
  ScreenHeader,
} from "../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../design-system";
import { fetchFriendProfile } from "../api/social";
import { getInitials } from "../utils/getInitials";
import { flameLevelFromConsistency, flameBackgroundColor, flameTextColor } from "../utils/flameHelpers";
import type { FriendHabit, FriendProfileResponse } from "../api/social";
import type { ApiError } from "../api/types";

type Props = {
  friendId: string;
  /** Display name from the friends list (avoids a separate profile fetch). */
  displayName?: string | null;
  /** Username from the friends list. */
  username?: string;
  /** Date the friendship was established. */
  since?: string;
  onBack?: () => void;
  onSetChallenge?: (friendId: string, friendName: string) => void;
};

export function FriendProfileScreen({
  friendId,
  displayName,
  username,
  since,
  onBack,
  onSetChallenge,
}: Props) {
  const colors = lightTheme;
  const [data, setData] = useState<FriendProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFriendProfile(friendId);
      setData(result);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [friendId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const name = displayName ?? (username ? `@${username}` : `User ${friendId.slice(0, 8)}`);
  const initials = getInitials(displayName, username, friendId);

  // Loading state
  if (loading && !data) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="friend-profile-loading">
        <ScreenHeader title={name} onBack={onBack} />
        <View style={styles.center}>
          <LoadingState message="Loading profile..." />
        </View>
      </View>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="friend-profile-error">
        <ScreenHeader title={name} onBack={onBack} />
        <View style={styles.center}>
          <ErrorState message={error.message} onRetry={loadProfile} />
        </View>
      </View>
    );
  }

  const habits = data?.habits ?? [];
  const aggregateConsistency =
    habits.length > 0
      ? habits.reduce((sum, h) => sum + h.consistency, 0) / habits.length
      : 0;
  const aggregateFlameLevel = flameLevelFromConsistency(aggregateConsistency);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="friend-profile-screen">
      <ScreenHeader title={name} onBack={onBack} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={loadProfile}
            tintColor={colors.brandPrimary}
          />
        }
        testID="friend-profile-scroll"
      >
        {/* Profile header */}
        <View style={styles.profileHeader} testID="friend-profile-header">
          <View style={styles.avatarWrapper}>
            <Avatar initials={initials} size="lg" />
          </View>
          <Text style={[styles.profileName, { color: colors.textPrimary }]}>{name}</Text>
          {username && displayName && (
            <Text style={[styles.profileUsername, { color: colors.textSecondary }]}>
              @{username}
            </Text>
          )}
          {since && (
            <Text style={[styles.memberSince, { color: colors.textTertiary }]} testID="member-since">
              Friends since {new Date(since).toLocaleDateString()}
            </Text>
          )}

          {/* Aggregate flame — the hero visual */}
          {habits.length > 0 && (
            <View style={styles.heroFlame} testID="aggregate-flame">
              <Flame flameLevel={aggregateFlameLevel} size="lg" consistency={aggregateConsistency} />
              <Text style={[styles.consistencyLabel, { color: colors.textSecondary }]}>
                {Math.round(aggregateConsistency)}% consistency
              </Text>
            </View>
          )}
        </View>

        {/* Actions — only show Set Challenge when the feature is wired */}
        {onSetChallenge && (
          <View style={styles.actions} testID="set-challenge-button">
            <Button
              title="Set Challenge"
              onPress={() => onSetChallenge(friendId, name)}
              variant="secondary"
              size="md"
              accessibilityLabel="Set challenge for this friend"
            />
          </View>
        )}

        {/* Visible habits */}
        {habits.length === 0 && data?.habitsUnavailable ? (
          <View style={styles.emptySection} testID="habits-degraded">
            <ErrorState
              title="Couldn't load habits"
              message="Habit data is temporarily unavailable. Try again in a moment."
              onRetry={loadProfile}
            />
          </View>
        ) : habits.length === 0 ? (
          <View style={styles.emptySection} testID="no-habits-empty">
            <EmptyState
              title="No shared habits"
              message={`${name} hasn't shared any habits with you yet. When they do, you'll see their flames here.`}
              hideIllustration
            />
          </View>
        ) : (
          <View style={styles.habitsSection} testID="habits-section">
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              SHARED HABITS
            </Text>
            {habits.map((habit) => (
              <HabitRow key={habit.id} habit={habit} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// --- Habit row with prominent flame ---

function HabitRow({ habit }: { habit: FriendHabit }) {
  const colors = lightTheme;

  return (
    <Card style={styles.habitCard}>
      <View style={styles.habitRow} testID={`habit-${habit.id}`}>
        <View style={styles.habitFlame}>
          <Flame flameLevel={habit.flameLevel} size="md" consistency={habit.consistency} />
        </View>
        <View style={styles.habitInfo}>
          <Text style={[styles.habitName, { color: colors.textPrimary }]} numberOfLines={1}>
            {habit.icon ? `${habit.icon} ` : ""}{habit.name}
          </Text>
          <Text style={[styles.habitConsistency, { color: colors.textSecondary }]}>
            {Math.round(habit.consistency)}% consistency
          </Text>
        </View>
        <View
          style={[styles.flameBadge, { backgroundColor: flameBackgroundColor(habit.flameLevel) }]}
        >
          <Text style={[styles.flameBadgeText, { color: flameTextColor(habit.flameLevel) }]}>
            {habit.flameLevel}
          </Text>
        </View>
      </View>
    </Card>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
  },
  scrollContent: {
    paddingBottom: spacing["3xl"],
  },
  profileHeader: {
    alignItems: "center",
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
    paddingHorizontal: spacing.xl,
  },
  avatarWrapper: {
    marginBottom: spacing.base,
  },
  profileName: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  profileUsername: {
    ...typography.body,
    marginBottom: spacing.xs,
  },
  memberSince: {
    ...typography.caption,
    marginBottom: spacing.base,
  },
  heroFlame: {
    alignItems: "center",
    marginTop: spacing.base,
    gap: spacing.sm,
  },
  consistencyLabel: {
    ...typography.bodyLarge,
  },
  actions: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  emptySection: {
    paddingTop: spacing.xl,
  },
  habitsSection: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.label,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  habitCard: {
    padding: 0,
    ...shadows.sm,
  },
  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    gap: spacing.md,
  },
  habitFlame: {
    width: 48,
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
});
