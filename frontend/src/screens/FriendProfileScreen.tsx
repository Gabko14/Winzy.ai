import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import {
  Card,
  Flame,
  LoadingState,
  ErrorState,
  EmptyState,
  Button,
} from "../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../design-system";
import type { FlameLevel } from "../design-system";
import { fetchFriendProfile } from "../api/social";
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
  onSetChallenge?: (friendId: string) => void;
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
        <Header name={name} onBack={onBack} />
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
        <Header name={name} onBack={onBack} />
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
      <Header name={name} onBack={onBack} />

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
          <View style={[styles.avatar, { backgroundColor: colors.brandMuted }]}>
            <Text style={[styles.avatarText, { color: colors.brandPrimary }]}>
              {initials}
            </Text>
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
              onPress={() => onSetChallenge(friendId)}
              variant="secondary"
              size="md"
              accessibilityLabel="Set challenge for this friend"
            />
          </View>
        )}

        {/* Visible habits */}
        {habits.length === 0 ? (
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

// --- Header with back button ---

function Header({ name, onBack }: { name: string; onBack?: () => void }) {
  const colors = lightTheme;

  return (
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
      <Text
        style={[styles.headerTitle, { color: colors.textPrimary }]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {name}
      </Text>
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

// --- Helpers ---

function getInitials(displayName?: string | null, username?: string, friendId?: string): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  if (username) return username.slice(0, 2).toUpperCase();
  return (friendId ?? "??").slice(0, 2).toUpperCase();
}

function flameLevelFromConsistency(consistency: number): FlameLevel {
  if (consistency >= 80) return "blazing";
  if (consistency >= 55) return "strong";
  if (consistency >= 30) return "steady";
  if (consistency >= 10) return "ember";
  return "none";
}

function flameBackgroundColor(level: FlameLevel): string {
  switch (level) {
    case "blazing": return "#FEE2E2";
    case "strong": return "#FFEDD5";
    case "steady": return "#FFF7ED";
    case "ember": return "#FEF3C7";
    case "none":
    default: return "#F5F5F4";
  }
}

function flameTextColor(level: FlameLevel): string {
  switch (level) {
    case "blazing": return "#DC2626";
    case "strong": return "#F97316";
    case "steady": return "#EA580C";
    case "ember": return "#D97706";
    case "none":
    default: return "#78716C";
  }
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing.sm,
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
  scrollContent: {
    paddingBottom: spacing["3xl"],
  },
  profileHeader: {
    alignItems: "center",
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
    paddingHorizontal: spacing.xl,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.base,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: "600",
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
