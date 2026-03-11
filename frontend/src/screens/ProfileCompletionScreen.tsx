import React, { useCallback, useState } from "react";
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
  onComplete: () => void;
};

export function ProfileCompletionScreen({ onComplete }: Props) {
  const { updateProfile } = useAuth();
  const colors = lightTheme;

  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSave = useCallback(async () => {
    setError(null);
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError("Please enter a display name.");
      return;
    }
    if (trimmed.length > 128) {
      setError("Display name must not exceed 128 characters.");
      return;
    }

    setLoading(true);
    try {
      await updateProfile({ displayName: trimmed });
      onComplete();
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
  }, [displayName, updateProfile, onComplete]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              What should we call you?
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Pick a display name. You can change it later.
            </Text>
          </View>

          {error && (
            <View
              style={[styles.errorBanner, { backgroundColor: colors.errorBackground }]}
              accessibilityRole="alert"
              testID="completion-error"
            >
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            </View>
          )}

          <View style={styles.form}>
            <TextInput
              label="Display name"
              placeholder="e.g. Alex"
              value={displayName}
              onChangeText={(text) => {
                setDisplayName(text);
                if (error) setError(null);
              }}
              validationState={error ? "error" : "default"}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSave}
              testID="display-name-input"
            />

            <Button
              title="Continue"
              onPress={handleSave}
              loading={loading}
              disabled={loading}
              size="lg"
            />

            <Button
              title="Skip for now"
              onPress={handleSkip}
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
  subtitle: {
    ...typography.body,
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
  form: {
    gap: spacing.base,
  },
});
