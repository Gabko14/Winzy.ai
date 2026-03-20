import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Button } from "../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../design-system";
import { useAuth } from "../hooks/useAuth";
import { getInitials } from "../utils/getInitials";

type Props = {
  onEditProfile: () => void;
  onSettings: () => void;
  onChallenges?: () => void;
};

export function ProfileScreen({ onEditProfile, onSettings, onChallenges }: Props) {
  const auth = useAuth();
  const colors = lightTheme;

  if (auth.status !== "authenticated") return null;

  const { user } = auth;
  const initials = getInitials(user.displayName, user.username);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="profile-screen">
      <View style={styles.content}>
        {/* Avatar / Initials */}
        <View
          style={[styles.avatar, { backgroundColor: colors.brandMuted }]}
          testID="profile-avatar"
        >
          <Text style={[styles.avatarText, { color: colors.brandPrimary }]}>
            {initials}
          </Text>
        </View>

        {/* Display name */}
        <Text style={[styles.displayName, { color: colors.textPrimary }]} testID="profile-display-name">
          {user.displayName || user.username}
        </Text>

        {/* Username */}
        <Text style={[styles.username, { color: colors.textSecondary }]} testID="profile-username">
          @{user.username}
        </Text>

        {/* Email */}
        <Text style={[styles.email, { color: colors.textTertiary }]} testID="profile-email">
          {user.email}
        </Text>

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            title="Edit profile"
            onPress={onEditProfile}
            variant="secondary"
            size="lg"
          />

          {onChallenges && (
            <Pressable
              onPress={onChallenges}
              style={[styles.settingsLink]}
              testID="challenges-link"
            >
              <Text style={[styles.settingsText, { color: colors.brandPrimary }]}>
                My Challenges
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={onSettings}
            style={[styles.settingsLink]}
            testID="settings-link"
          >
            <Text style={[styles.settingsText, { color: colors.brandPrimary }]}>
              Settings
            </Text>
          </Pressable>
        </View>

        {/* Sign out */}
        <View style={styles.signOutContainer}>
          <Button
            title="Sign out"
            onPress={auth.logout}
            variant="ghost"
            size="sm"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
    maxWidth: 400,
    width: "100%",
    alignSelf: "center",
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.base,
    ...shadows.md,
  },
  avatarText: {
    ...typography.h2,
  },
  displayName: {
    ...typography.h3,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  username: {
    ...typography.body,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  email: {
    ...typography.bodySmall,
    textAlign: "center",
    marginBottom: spacing["2xl"],
  },
  actions: {
    width: "100%",
    gap: spacing.base,
    alignItems: "center",
  },
  settingsLink: {
    padding: spacing.sm,
  },
  settingsText: {
    ...typography.body,
    fontWeight: "500",
  },
  signOutContainer: {
    marginTop: spacing["3xl"],
  },
});
