import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from "react-native";
import { Avatar, Button, TextInput } from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { useAuth } from "../hooks/useAuth";
import { useAvatarUpload } from "../hooks/useAvatarUpload";
import { isApiError } from "../api";
import { getInitials } from "../utils/getInitials";
import { resolveAvatarUrl } from "../utils/avatarUrl";

type Props = {
  onBack: () => void;
};

export function EditProfileScreen({ onBack }: Props) {
  const auth = useAuth();
  const colors = lightTheme;
  const { pickAndUpload, remove, busy: avatarBusy, error: avatarError, clearError: clearAvatarError } =
    useAvatarUpload();

  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current && auth.status === "authenticated") {
      setDisplayName(auth.user.displayName ?? "");
      seeded.current = true;
    }
  }, [auth]);

  const handleSave = useCallback(async () => {
    if (auth.status !== "authenticated") return;

    setError(null);
    setSuccess(false);

    const trimmed = displayName.trim();
    if (!trimmed) {
      setError("Display name cannot be empty.");
      return;
    }
    if (trimmed.length > 128) {
      setError("Display name must not exceed 128 characters.");
      return;
    }

    if (trimmed === auth.user.displayName) {
      onBack();
      return;
    }

    setLoading(true);
    try {
      await auth.updateProfile({ displayName: trimmed });
      setSuccess(true);
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === "network") {
          setError("Unable to reach the server. Please check your connection.");
        } else if (err.code === "validation" && err.validationErrors?.displayName) {
          setError(err.validationErrors.displayName[0]);
        } else {
          setError(err.message);
        }
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [auth, displayName, onBack]);

  const busy = loading || avatarBusy;
  const bannerError = error ?? avatarError;
  const user = auth.status === "authenticated" ? auth.user : null;
  const initials = user ? getInitials(user.displayName, user.username) : "??";
  const imageUrl = user ? resolveAvatarUrl(user.avatarUrl) : undefined;

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container} testID="edit-profile-screen">
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Edit profile</Text>
          </View>

          {bannerError && (
            <View
              style={[styles.errorBanner, { backgroundColor: colors.errorBackground }]}
              accessibilityRole="alert"
              testID="edit-error"
            >
              <Text style={[styles.errorText, { color: colors.error }]}>{bannerError}</Text>
            </View>
          )}

          {success && (
            <View
              style={[styles.successBanner, { backgroundColor: colors.successBackground }]}
              accessibilityRole="alert"
              testID="edit-success"
            >
              <Text style={[styles.successText, { color: colors.success }]}>
                Profile updated!
              </Text>
            </View>
          )}

          <View style={styles.avatarSection}>
            <Pressable
              onPress={() => {
                clearAvatarError();
                void pickAndUpload();
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Change photo"
              testID="edit-avatar-pressable"
            >
              <Avatar
                initials={initials}
                size="xl"
                imageUrl={imageUrl}
                testID="edit-avatar"
              />
            </Pressable>
            <Button
              title="Change photo"
              onPress={() => {
                clearAvatarError();
                void pickAndUpload();
              }}
              variant="secondary"
              size="sm"
              loading={avatarBusy}
              disabled={busy}
            />
            {user?.avatarUrl ? (
              <Button
                title="Remove photo"
                onPress={() => {
                  clearAvatarError();
                  void remove();
                }}
                variant="ghost"
                size="sm"
                disabled={busy}
              />
            ) : null}
          </View>

          <View style={styles.form}>
            <TextInput
              label="Display name"
              placeholder="Your display name"
              value={displayName}
              onChangeText={(text) => {
                setDisplayName(text);
                if (error) setError(null);
                if (success) setSuccess(false);
              }}
              validationState={error ? "error" : "default"}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSave}
              testID="edit-display-name-input"
            />

            <Button
              title="Save changes"
              onPress={handleSave}
              loading={loading}
              disabled={busy}
              size="lg"
            />

            <Button
              title="Cancel"
              onPress={onBack}
              variant="ghost"
              size="sm"
              disabled={busy}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  container: {
    padding: spacing["3xl"],
    maxWidth: 400,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    marginBottom: spacing["2xl"],
  },
  title: {
    ...typography.h2,
    marginBottom: spacing.xs,
  },
  errorBanner: {
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.base,
  },
  errorText: {
    ...typography.bodySmall,
    fontWeight: "500",
  },
  successBanner: {
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.base,
  },
  successText: {
    ...typography.bodySmall,
    fontWeight: "600",
  },
  avatarSection: {
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing["2xl"],
  },
  form: {
    gap: spacing.base,
  },
});
