import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import {
  Card,
  Button,
  LoadingState,
  ErrorState,
  EmptyState,
  InlineError,
  spacing,
  typography,
  lightTheme,
  brand,
  shadows,
} from "../design-system";
import {
  kindMessageForClaimError,
  useClaimChallengeInvite,
  usePublicChallengeInvite,
} from "../hooks/useChallengeInviteClaim";
import { setPendingChallengeInviteToken } from "../utils/challengeInviteToken";
import { updateChallengeInviteOgTags } from "../pwa/register-sw";
import { isApiError } from "../api/types";

type Props = {
  token: string;
  isAuthenticated: boolean;
  onNavigateToSignUp: () => void;
  onAccepted: (habitName: string) => void;
};

export function ChallengeInviteScreen({
  token,
  isAuthenticated,
  onNavigateToSignUp,
  onAccepted,
}: Props) {
  const colors = lightTheme;
  const { data, loading, error, notFound, refresh } = usePublicChallengeInvite(token);
  const [claimError, setClaimError] = useState<string | null>(null);

  const claimMutation = useClaimChallengeInvite();

  useEffect(() => {
    if (!data) return;
    updateChallengeInviteOgTags(data.creatorDisplayName);
  }, [data]);

  const handleJoin = useCallback(() => {
    setPendingChallengeInviteToken(token);
    onNavigateToSignUp();
  }, [token, onNavigateToSignUp]);

  const handleAccept = useCallback(async () => {
    setClaimError(null);
    try {
      await claimMutation.claim(token);
      onAccepted(data?.habitName ?? "your new habit");
    } catch (err) {
      setClaimError(
        kindMessageForClaimError(isApiError(err) ? err : null),
      );
    }
  }, [claimMutation, token, onAccepted, data?.habitName]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="challenge-invite-loading">
        <LoadingState message="Loading invite..." />
      </View>
    );
  }

  if (notFound) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="challenge-invite-not-found">
        <EmptyState
          title="Invite not found"
          message="This link may be incomplete or no longer exists."
          actionLabel="Join Winzy"
          onAction={onNavigateToSignUp}
        />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="challenge-invite-error">
        <ErrorState message="Could not load this invite. Please try again." onRetry={refresh} />
      </View>
    );
  }

  const creator = data.creatorDisplayName?.trim() || "A friend";
  const inactive = data.status === "expired" || data.status === "revoked";
  const claimed = data.status === "claimed";

  if (claimed) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="challenge-invite-claimed">
        <EmptyState
          title="This challenge was already accepted"
          message="Someone already joined through this invite. Start your own habit journey on Winzy."
          actionLabel="Join Winzy"
          onAction={onNavigateToSignUp}
        />
      </View>
    );
  }

  if (inactive) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="challenge-invite-inactive">
        <EmptyState
          title="This invite is no longer active"
          message="It may have expired or been revoked. You can still join Winzy and build habits with friends."
          actionLabel="Join Winzy"
          onAction={onNavigateToSignUp}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.scrollContent}
      testID="challenge-invite-screen"
    >
      <View style={[styles.hero, { backgroundColor: colors.surface }]}>
        <Text style={[styles.eyebrow, { color: colors.textTertiary }]}>CHALLENGE INVITE</Text>
        <Text style={[styles.creator, { color: colors.textPrimary }]} testID="invite-creator">
          {creator} challenges you
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Join Winzy to accept — you'll get the habit and share the goal together.
        </Text>
      </View>

      <Card style={{ ...styles.card, ...shadows.md }}>
        <Text style={[styles.label, { color: colors.textTertiary }]}>HABIT</Text>
        <Text style={[styles.habitName, { color: colors.textPrimary }]} testID="invite-habit">
          {data.habitIcon ? `${data.habitIcon} ` : ""}
          {data.habitName}
        </Text>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Text style={[styles.label, { color: colors.textTertiary }]}>GOAL</Text>
        <Text style={[styles.body, { color: colors.textPrimary }]} testID="invite-goal">
          {data.targetValue}% consistency over {data.periodDays} days
        </Text>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Text style={[styles.label, { color: colors.textTertiary }]}>REWARD</Text>
        <Text style={[styles.body, { color: colors.textPrimary }]} testID="invite-reward">
          {data.rewardDescription}
        </Text>
      </Card>

      <View style={[styles.ctaSection, { backgroundColor: brand.flame50 }]}>
        {claimError && <InlineError message={claimError} testID="claim-error" />}
        {isAuthenticated ? (
          <Button
            title="Accept challenge"
            onPress={handleAccept}
            variant="primary"
            size="lg"
            loading={claimMutation.loading}
            disabled={claimMutation.loading}
            accessibilityLabel="Accept challenge invite"
          />
        ) : (
          <Button
            title="Join Winzy & accept"
            onPress={handleJoin}
            variant="primary"
            size="lg"
            accessibilityLabel="Join Winzy and accept challenge"
          />
        )}
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
    paddingBottom: spacing["5xl"],
  },
  hero: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing["2xl"],
    alignItems: "center",
    gap: spacing.sm,
  },
  eyebrow: {
    ...typography.caption,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  creator: {
    ...typography.h2,
    textAlign: "center",
  },
  subtitle: {
    ...typography.body,
    textAlign: "center",
  },
  card: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    padding: spacing.xl,
  },
  label: {
    ...typography.caption,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  habitName: {
    ...typography.h3,
  },
  body: {
    ...typography.bodyLarge,
  },
  divider: {
    height: 1,
    marginVertical: spacing.base,
  },
  ctaSection: {
    marginTop: spacing["2xl"],
    marginHorizontal: spacing.xl,
    padding: spacing.xl,
    borderRadius: 16,
    gap: spacing.md,
  },
});
