import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput as RNTextInput,
} from "react-native";
import { Button, TextInput } from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { useAuth } from "../hooks/useAuth";
import { isApiError } from "../api";
import { validateLoginIdentifier, validatePassword } from "../utils/validation";

type Props = {
  onNavigateToSignUp: () => void;
};

export function SignInScreen({ onNavigateToSignUp }: Props) {
  const { login } = useAuth();
  const colors = lightTheme;

  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const passwordRef = useRef<RNTextInput>(null);

  const validateForm = useCallback((): boolean => {
    const identifierError = validateLoginIdentifier(emailOrUsername);
    const passwordError = validatePassword(password);
    const newErrors: typeof errors = {};
    if (identifierError) newErrors.identifier = identifierError;
    if (passwordError) newErrors.password = passwordError;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [emailOrUsername, password]);

  const handleSubmit = useCallback(async () => {
    setServerError(null);
    if (!validateForm()) return;

    setLoading(true);
    try {
      await login(emailOrUsername.trim(), password);
      // Navigation happens automatically via auth state change
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === "unauthorized") {
          setServerError("Invalid email/username or password. Please try again.");
        } else if (err.code === "network") {
          setServerError("Unable to reach the server. Please check your connection.");
        } else if (err.code === "validation" && err.validationErrors) {
          const fieldErrors: typeof errors = {};
          if (err.validationErrors.emailOrUsername) {
            fieldErrors.identifier = err.validationErrors.emailOrUsername[0];
          }
          if (err.validationErrors.password) {
            fieldErrors.password = err.validationErrors.password[0];
          }
          setErrors(fieldErrors);
        } else {
          setServerError(err.message);
        }
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [emailOrUsername, password, login, validateForm]);

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
            <Text style={[styles.title, { color: colors.textPrimary }]}>Welcome back</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Sign in to keep your flame alive
            </Text>
          </View>

          {serverError && (
            <View
              style={[styles.errorBanner, { backgroundColor: colors.errorBackground }]}
              accessibilityRole="alert"
              testID="server-error"
            >
              <Text style={[styles.errorText, { color: colors.error }]}>{serverError}</Text>
            </View>
          )}

          <View style={styles.form}>
            <TextInput
              label="Email or username"
              placeholder="you@example.com"
              value={emailOrUsername}
              onChangeText={(text) => {
                setEmailOrUsername(text);
                if (errors.identifier) setErrors((e) => ({ ...e, identifier: undefined }));
                if (serverError) setServerError(null);
              }}
              validationState={errors.identifier ? "error" : "default"}
              errorMessage={errors.identifier}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              testID="identifier-input"
            />

            <TextInput
              ref={passwordRef}
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
                if (serverError) setServerError(null);
              }}
              validationState={errors.password ? "error" : "default"}
              errorMessage={errors.password}
              secureTextEntry
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              testID="password-input"
            />

            <Button
              title="Sign in"
              onPress={handleSubmit}
              loading={loading}
              disabled={loading}
              size="lg"
            />
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              {"Don\u2019t have an account? "}
            </Text>
            <Button
              title="Sign up"
              onPress={onNavigateToSignUp}
              variant="ghost"
              size="sm"
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
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
  },
  footerText: {
    ...typography.bodySmall,
  },
});
