import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Button, TextInput } from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { useAuth } from "../hooks/useAuth";
import { isApiError } from "../api";

type Props = {
  onBack: () => void;
};

export function EditProfileScreen({ onBack }: Props) {
  const auth = useAuth();
  const colors = lightTheme;

  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const seeded = useRef(false);

  // Seed the display name once auth is ready
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

    // No change — skip API call
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

          {error && (
            <View
              style={[styles.errorBanner, { backgroundColor: colors.errorBackground }]}
              accessibilityRole="alert"
              testID="edit-error"
            >
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
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
              disabled={loading}
              size="lg"
            />

            <Button
              title="Cancel"
              onPress={onBack}
              variant="ghost"
              size="sm"
              disabled={loading}
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
    fontWeight: "500",
  },
  form: {
    gap: spacing.base,
  },
});
