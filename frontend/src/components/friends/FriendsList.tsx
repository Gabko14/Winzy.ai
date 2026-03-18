import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Card, Flame } from "../../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../../design-system";
import type { Friend } from "../../api/social";

export function friendDisplayName(friend: Friend): string {
  if (friend.displayName) return friend.displayName;
  if (friend.username) return friend.username;
  return `User ${friend.friendId.slice(0, 8)}`;
}

export function friendInitials(friend: Friend): string {
  if (friend.displayName) {
    const parts = friend.displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  if (friend.username) return friend.username.slice(0, 2).toUpperCase();
  return friend.friendId.slice(0, 2).toUpperCase();
}

type FriendRowProps = {
  friend: Friend;
  onPress?: (friendId: string) => void;
  onOptions: () => void;
  processing: boolean;
};

export function FriendRow({ friend, onPress, onOptions, processing }: FriendRowProps) {
  const colors = lightTheme;
  const name = friendDisplayName(friend);
  const initials = friendInitials(friend);
  const flameLevel = friend.flameLevel ?? "none";

  return (
    <Card style={styles.friendCard}>
      <Pressable
        style={styles.friendRow}
        onPress={() => onPress?.(friend.friendId)}
        onLongPress={onOptions}
        accessibilityRole="button"
        accessibilityLabel={`Friend ${name}`}
        accessibilityHint="Tap to view profile"
        testID={`friend-${friend.friendId}`}
        disabled={processing}
      >
        <View style={[styles.avatar, { backgroundColor: colors.brandMuted }]}>
          <Text style={styles.avatarText}>
            {initials}
          </Text>
        </View>

        <View style={styles.friendInfo}>
          <Text style={[styles.friendName, { color: colors.textPrimary }]} numberOfLines={1}>
            {name}
          </Text>
          {friend.username && (
            <Text style={[styles.friendUsername, { color: colors.textSecondary }]} numberOfLines={1}>
              @{friend.username}
            </Text>
          )}
          <Text style={[styles.friendSince, { color: colors.textSecondary }]}>
            Friends since {new Date(friend.since).toLocaleDateString()}
          </Text>
        </View>

        <View style={styles.flameContainer} testID={`flame-${friend.friendId}`}>
          {friend.habitsUnavailable ? (
            <View
              style={styles.flameUnavailable}
              accessibilityLabel="Flame data temporarily unavailable"
              testID={`flame-unavailable-${friend.friendId}`}
            >
              <View style={{ opacity: 0.3 }}>
                <Flame flameLevel="none" size="sm" />
              </View>
              <Text style={[styles.unavailableBadge, { color: colors.textSecondary }]}>?</Text>
            </View>
          ) : (
            <Flame flameLevel={flameLevel} size="sm" consistency={friend.consistency} />
          )}
        </View>

        <Pressable
          onPress={onOptions}
          accessibilityRole="button"
          accessibilityLabel={`Options for ${name}`}
          hitSlop={8}
          style={styles.menuButton}
          testID={`menu-${friend.friendId}`}
          disabled={processing}
        >
          <Text style={[styles.menuIcon, { color: colors.textSecondary }]}>
            {"\u2026"}
          </Text>
        </Pressable>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  friendCard: {
    padding: 0,
    ...shadows.sm,
  },
  friendRow: {
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
    color: lightTheme.brandPrimary,
  },
  friendInfo: {
    flex: 1,
  },
  flameContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.xs,
  },
  flameUnavailable: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  unavailableBadge: {
    position: "absolute",
    bottom: 0,
    fontSize: 10,
    fontWeight: "700",
  },
  menuButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
  menuIcon: {
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: 1,
  },
  friendName: {
    ...typography.body,
    fontWeight: "600",
  },
  friendUsername: {
    ...typography.bodySmall,
  },
  friendSince: {
    ...typography.caption,
  },
});
