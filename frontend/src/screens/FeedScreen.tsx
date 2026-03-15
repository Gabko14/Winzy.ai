import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import {
  Card,
  EmptyState,
  LoadingState,
  ErrorState,
} from "../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../design-system";
import { useFeed } from "../hooks/useFeed";
import { useFriends } from "../hooks/useFriends";
import type { FeedEntry, FeedEventType } from "../api/feed";

// --- Event type display config ---

type EventConfig = {
  icon: string;
  label: (data: Record<string, unknown> | null) => string;
};

const eventConfigs: Record<FeedEventType, EventConfig> = {
  "habit.completed": {
    icon: "check",
    label: () => "completed a habit",
  },
  "habit.created": {
    icon: "plus",
    label: () => "started tracking a new habit",
  },
  "friend.request.accepted": {
    icon: "handshake",
    label: () => "became friends with someone",
  },
  "challenge.created": {
    icon: "flag",
    label: () => "set a challenge",
  },
  "challenge.completed": {
    icon: "trophy",
    label: (data) => {
      const reward = data?.reward;
      if (typeof reward === "string" && reward.length > 0) {
        return `completed a challenge: ${reward}`;
      }
      return "completed a challenge";
    },
  },
  "user.registered": {
    icon: "wave",
    label: () => "joined Winzy",
  },
};

function getEventLabel(eventType: FeedEventType, data: Record<string, unknown> | null): string {
  const config = eventConfigs[eventType];
  if (!config) return "did something";
  return config.label(data);
}

function getEventIcon(eventType: FeedEventType): string {
  switch (eventType) {
    case "habit.completed":
      return "\u2705";
    case "habit.created":
      return "\u2795";
    case "friend.request.accepted":
      return "\uD83E\uDD1D";
    case "challenge.created":
      return "\uD83C\uDFF4";
    case "challenge.completed":
      return "\uD83C\uDFC6";
    case "user.registered":
      return "\uD83D\uDC4B";
    default:
      return "\uD83D\uDD14";
  }
}

// --- Time formatting ---

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(isoDate).toLocaleDateString();
}

// --- Actor display helpers ---

function actorDisplayName(entry: FeedEntry): string {
  if (entry.actorDisplayName) return entry.actorDisplayName;
  if (entry.actorUsername) return entry.actorUsername;
  return entry.actorId.slice(0, 8);
}

function actorInitials(entry: FeedEntry): string {
  if (entry.actorDisplayName) {
    const parts = entry.actorDisplayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return entry.actorDisplayName.slice(0, 2).toUpperCase();
  }
  if (entry.actorUsername) {
    return entry.actorUsername.slice(0, 2).toUpperCase();
  }
  return entry.actorId.slice(0, 2).toUpperCase();
}

// --- Props ---

type Props = {
  onAvatarPress?: (actorId: string) => void;
  onChallengePress?: (challengeId: string) => void;
};

export function FeedScreen({ onAvatarPress, onChallengePress }: Props) {
  const colors = lightTheme;
  const feed = useFeed();
  const friends = useFriends();

  const hasFriends = friends.friends.length > 0;
  const friendsResolved = !friends.loading;
  const { loadMore } = feed;

  const handleEndReached = useCallback(() => {
    loadMore();
  }, [loadMore]);

  // Initial loading state
  if (feed.loading && feed.items.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="feed-loading">
        <LoadingState message="Loading activity..." />
      </View>
    );
  }

  // Error state
  if (feed.error && feed.items.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="feed-error">
        <ErrorState message={feed.error.message} onRetry={feed.refresh} />
      </View>
    );
  }

  // Empty state: no friends
  if (!friends.loading && friends.friends.length === 0 && feed.items.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="feed-empty-no-friends">
        <Header />
        <View style={styles.emptyContainer}>
          <EmptyState
            title="Add friends to see activity"
            message="Once you connect with friends, their habit completions and achievements will show up here."
            hideIllustration
          />
        </View>
      </View>
    );
  }

  // Empty state: has friends but quiet feed
  if (!feed.loading && friendsResolved && feed.items.length === 0 && hasFriends) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="feed-empty-quiet">
        <Header />
        <View style={styles.emptyContainer}>
          <EmptyState
            title="No recent activity"
            message="When your friends complete habits or set challenges, you'll see it here."
            hideIllustration
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="feed-screen">
      <Header />
      <FlatList
        data={feed.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <FeedEntryRow
            entry={item}
            onAvatarPress={onAvatarPress}
            onChallengePress={onChallengePress}
          />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={feed.loading}
            onRefresh={feed.refresh}
            tintColor={colors.brandPrimary}
          />
        }
        ListFooterComponent={
          feed.loadingMore ? (
            <View style={styles.footer} testID="feed-loading-more">
              <ActivityIndicator size="small" color={colors.brandPrimary} />
            </View>
          ) : null
        }
        testID="feed-list"
      />
    </View>
  );
}

// --- Header ---

function Header() {
  const colors = lightTheme;
  return (
    <View style={styles.header}>
      <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Activity</Text>
    </View>
  );
}

// --- Feed Entry Row ---

type FeedEntryRowProps = {
  entry: FeedEntry;
  onAvatarPress?: (actorId: string) => void;
  onChallengePress?: (challengeId: string) => void;
};

function FeedEntryRow({ entry, onAvatarPress, onChallengePress }: FeedEntryRowProps) {
  const colors = lightTheme;
  const icon = getEventIcon(entry.eventType);
  const label = getEventLabel(entry.eventType, entry.data);
  const initials = actorInitials(entry);
  const name = actorDisplayName(entry);
  const timestamp = formatRelativeTime(entry.createdAt);

  const isChallengeEntry =
    entry.eventType === "challenge.created" || entry.eventType === "challenge.completed";
  const challengeId =
    isChallengeEntry && entry.data?.challengeId
      ? String(entry.data.challengeId)
      : null;

  const handlePress = useCallback(() => {
    if (challengeId && onChallengePress) {
      onChallengePress(challengeId);
    }
  }, [challengeId, onChallengePress]);

  const content = (
    <View style={styles.entryRow}>
      <Pressable
        onPress={() => onAvatarPress?.(entry.actorId)}
        accessibilityRole="button"
        accessibilityLabel={`View profile of ${name}`}
        testID={`feed-avatar-${entry.id}`}
      >
        <View style={[styles.avatar, { backgroundColor: colors.brandMuted }]}>
          <Text style={[styles.avatarText, { color: colors.brandPrimary }]}>
            {initials}
          </Text>
        </View>
      </Pressable>

      <View style={styles.entryContent}>
        <Text style={[styles.entryText, { color: colors.textPrimary }]} numberOfLines={2}>
          <Text style={styles.entryIcon}>{icon} </Text>
          <Text style={styles.actorName}>{name} </Text>
          {label}
        </Text>
        <Text style={[styles.entryTimestamp, { color: colors.textSecondary }]}>
          {timestamp}
        </Text>
      </View>
    </View>
  );

  if (isChallengeEntry && challengeId && onChallengePress) {
    return (
      <Card style={styles.entryCard}>
        <Pressable
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={`${label} - tap for details`}
          testID={`feed-entry-${entry.id}`}
        >
          {content}
        </Pressable>
      </Card>
    );
  }

  return (
    <View testID={`feed-entry-${entry.id}`}>
      <Card style={styles.entryCard}>
        {content}
      </Card>
    </View>
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
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    ...typography.h2,
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["3xl"],
    gap: spacing.md,
  },
  entryCard: {
    padding: 0,
    ...shadows.sm,
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "600",
  },
  entryContent: {
    flex: 1,
    gap: spacing.xs,
  },
  entryText: {
    ...typography.body,
  },
  entryIcon: {
    fontSize: 16,
  },
  actorName: {
    fontWeight: "600",
  },
  entryTimestamp: {
    ...typography.caption,
  },
  footer: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
});
