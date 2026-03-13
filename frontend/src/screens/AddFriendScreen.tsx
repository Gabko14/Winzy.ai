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
} from "../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../design-system";
import { useUserSearch } from "../hooks/useUserSearch";
import { sendFriendRequest } from "../api/social";
import type { UserSearchResult } from "../api/social";
import type { ApiError } from "../api/types";

type Props = {
  currentUserId?: string;
  onBack?: () => void;
};

export function AddFriendScreen({ currentUserId, onBack }: Props) {
  const colors = lightTheme;
  const { query, setQuery, results, loading, error, clear } = useUserSearch();
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const handleSendRequest = useCallback(
    async (user: UserSearchResult) => {
      if (currentUserId && user.id === currentUserId) {
        Alert.alert("That's you!", "You can't send a friend request to yourself.");
        return;
      }

      setSendingId(user.id);
      setSendError(null);

      try {
        await sendFriendRequest(user.id);
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
    [currentUserId],
  );

  const renderUser = useCallback(
    ({ item }: { item: UserSearchResult }) => {
      const isSelf = currentUserId === item.id;
      const alreadySent = sentIds.has(item.id);

      return (
        <Card style={styles.userCard}>
          <View style={styles.userRow}>
            <View style={[styles.avatar, { backgroundColor: colors.brandMuted }]}>
              <Text style={[styles.avatarText, { color: colors.brandPrimary }]}>
                {(item.displayName ?? item.username).slice(0, 2).toUpperCase()}
              </Text>
            </View>

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
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Find Friends</Text>
      </View>

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
    </View>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
});
