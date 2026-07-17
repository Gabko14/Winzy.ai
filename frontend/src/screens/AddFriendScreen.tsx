import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
} from "react-native";
import {
  Card,
  TextInput,
  EmptyState,
  LoadingState,
  ErrorState,
  Button,
  Badge,
  Avatar,
  ScreenHeader,
} from "../design-system";
import { spacing, typography, lightTheme, shadows } from "../design-system";
import { useUserSearch } from "../hooks/useUserSearch";
import { useMutation } from "@tanstack/react-query";
import { sendFriendRequest } from "../api/social";
import { queryKeys } from "../api/queryKeys";
import { getInitials } from "../utils/getInitials";
import type { UserSearchResult } from "../api/social";
import type { ApiError } from "../api/types";

type Props = {
  currentUserId?: string;
  onBack?: () => void;
  onChallengeInvite?: () => void;
};

export function AddFriendScreen({ currentUserId, onBack, onChallengeInvite }: Props) {
  const colors = lightTheme;
  const { query, setQuery, results, loading, error, clear } = useUserSearch();
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const sendMutation = useMutation({
    mutationFn: (friendId: string) => sendFriendRequest(friendId),
    onSettled: (_data, _error, _vars, _onMutateResult, { client }) => {
      void client.invalidateQueries({ queryKey: queryKeys.friends.requests() });
    },
  });

  const handleSendRequest = useCallback(
    async (user: UserSearchResult) => {
      if (currentUserId && user.id === currentUserId) {
        Alert.alert("That's you!", "You can't send a friend request to yourself.");
        return;
      }

      setSendingId(user.id);
      setSendError(null);

      try {
        await sendMutation.mutateAsync(user.id);
        setSentIds((s) => new Set(s).add(user.id));
        Alert.alert("Request sent!", `Friend request sent to ${user.displayName ?? user.username}.`);
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.code === "conflict") {
          setSendError(apiErr.message);
        } else {
          setSendError("Failed to send request. Please try again.");
        }
      } finally {
        setSendingId(null);
      }
    },
    [currentUserId, sendMutation.mutateAsync],
  );

  const renderUser = useCallback(
    ({ item }: { item: UserSearchResult }) => {
      const isSelf = currentUserId === item.id;
      const alreadySent = sentIds.has(item.id);

      return (
        <Card style={styles.userCard}>
          <View style={styles.userRow}>
            <Avatar initials={getInitials(item.displayName, item.username)} size="md" />

            <View style={styles.userInfo}>
              {item.displayName && (
                <Text style={[styles.displayName, { color: colors.textPrimary }]} numberOfLines={1}>
                  {item.displayName}
                </Text>
              )}
              <Text style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
                @{item.username}
              </Text>
            </View>

            {isSelf ? (
              <Badge label="You" variant="default" />
            ) : alreadySent ? (
              <Badge label="Sent" variant="success" />
            ) : (
              <Button
                title="Add"
                onPress={() => handleSendRequest(item)}
                variant="primary"
                size="sm"
                loading={sendingId === item.id}
                disabled={sendingId === item.id}
              />
            )}
          </View>
        </Card>
      );
    },
    [currentUserId, sentIds, sendingId, handleSendRequest, colors],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="add-friend-screen">
      <ScreenHeader title="Find Friends" onBack={onBack} />

      <View style={styles.searchContainer}>
        <TextInput
          label=""
          value={query}
          onChangeText={setQuery}
          placeholder="Search by username or name..."
          testID="user-search-input"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable
            onPress={clear}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            style={styles.clearButton}
            testID="clear-search"
          >
            <Text style={[styles.clearText, { color: colors.textSecondary }]}>{"\u2715"}</Text>
          </Pressable>
        )}
      </View>

      {sendError && (
        <View style={styles.errorBanner}>
          <Text style={[styles.errorText, { color: colors.error }]}>{sendError}</Text>
        </View>
      )}

      {loading && query.trim().length >= 2 && (
        <View style={styles.loadingContainer} testID="search-loading">
          <LoadingState message="Searching..." />
        </View>
      )}

      {error && (
        <View style={styles.errorContainer} testID="search-error">
          <ErrorState message={error.message} onRetry={() => setQuery(query)} />
        </View>
      )}

      {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
        <View style={styles.emptyContainer} testID="search-empty">
          <EmptyState
            title="No users found"
            message={`No results for "${query}". Try a different username or name.`}
            hideIllustration
          />
        </View>
      )}

      {query.trim().length < 2 && !loading && (
        <View style={styles.emptyContainer} testID="search-hint">
          <EmptyState
            title="Search for friends"
            message="Type at least 2 characters to search by username or display name."
            hideIllustration
          />
        </View>
      )}

      {results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          contentContainerStyle={styles.resultsList}
          showsVerticalScrollIndicator={false}
          testID="search-results"
        />
      )}

      {onChallengeInvite && (
        <View style={styles.inviteSection} testID="challenge-invite-entry">
          <Text style={[styles.inviteTitle, { color: colors.textPrimary }]}>
            Friend not on Winzy yet?
          </Text>
          <Text style={[styles.inviteMessage, { color: colors.textSecondary }]}>
            Challenge them to join — they'll get a habit and a shared goal when they accept.
          </Text>
          <Button
            title="Create challenge invite"
            onPress={onChallengeInvite}
            variant="secondary"
            size="md"
            accessibilityLabel="Create a challenge invite for someone not on Winzy"
          />
        </View>
      )}
    </View>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.base,
    position: "relative",
  },
  clearButton: {
    position: "absolute",
    right: spacing.xl + spacing.md,
    top: spacing.md,
    padding: spacing.xs,
  },
  clearText: {
    fontSize: 16,
  },
  errorBanner: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  errorText: {
    ...typography.bodySmall,
  },
  loadingContainer: {
    padding: spacing["2xl"],
    alignItems: "center",
  },
  errorContainer: {
    padding: spacing.xl,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  resultsList: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["3xl"],
    gap: spacing.md,
  },
  userCard: {
    padding: 0,
    ...shadows.sm,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    gap: spacing.md,
  },
  userInfo: {
    flex: 1,
  },
  displayName: {
    ...typography.body,
    fontWeight: "600",
  },
  username: {
    ...typography.bodySmall,
  },
  inviteSection: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: lightTheme.border,
  },
  inviteTitle: {
    ...typography.label,
  },
  inviteMessage: {
    ...typography.bodySmall,
    marginBottom: spacing.sm,
  },
});
