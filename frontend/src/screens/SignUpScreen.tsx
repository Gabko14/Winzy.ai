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
import { validateEmail, validateUsername, validatePassword } from "../utils/validation";

type Props = {
  onNavigateToSignIn: () => void;
};

export function SignUpScreen({ onNavigateToSignIn }: Props) {
  const { register } = useAuth();
  const colors = lightTheme;

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{
    email?: string;
    username?: string;
    password?: string;
  }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const usernameRef = useRef<RNTextInput>(null);
  const passwordRef = useRef<RNTextInput>(null);

  const validateForm = useCallback((): boolean => {
    const emailError = validateEmail(email);
    const usernameError = validateUsername(username);
    const passwordError = validatePassword(password);
    const newErrors: typeof errors = {};
    if (emailError) newErrors.email = emailError;
    if (usernameError) newErrors.username = usernameError;
    if (passwordError) newErrors.password = passwordError;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [email, username, password]);

  const handleSubmit = useCallback(async () => {
    setServerError(null);
    if (!validateForm()) return;

    setLoading(true);
    try {
      await register(email.trim(), username.trim(), password);
      // Navigation happens automatically via auth state change
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === "conflict") {
          // Backend returns "Email already registered." or "Username already taken."
          const msg = err.message.toLowerCase();
          if (msg.includes("email")) {
            setErrors((e) => ({ ...e, email: "This email is already registered." }));
          } else if (msg.includes("username")) {
            setErrors((e) => ({ ...e, username: "This username is already taken. Try another one." }));
          } else {
            setServerError(err.message);
          }
        } else if (err.code === "validation" && err.validationErrors) {
          const fieldErrors: typeof errors = {};
          if (err.validationErrors.email) {
            fieldErrors.email = err.validationErrors.email[0];
          }
          if (err.validationErrors.username) {
            fieldErrors.username = err.validationErrors.username[0];
          }
          if (err.validationErrors.password) {
            fieldErrors.password = err.validationErrors.password[0];
          }
          setErrors(fieldErrors);
        } else if (err.code === "network") {
          setServerError("Unable to reach the server. Please check your connection.");
        } else {
          setServerError(err.message);
        }
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [email, username, password, register, validateForm]);

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
            <Text style={[styles.title, { color: colors.textPrimary }]}>Create your account</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Start building habits that stick
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
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
                if (serverError) setServerError(null);
              }}
              validationState={errors.email ? "error" : "default"}
              errorMessage={errors.email}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => usernameRef.current?.focus()}
              testID="email-input"
            />

            <TextInput
              ref={usernameRef}
              label="Username"
              placeholder="your-unique-handle"
              value={username}
              onChangeText={(text) => {
                setUsername(text);
                if (errors.username) setErrors((e) => ({ ...e, username: undefined }));
                if (serverError) setServerError(null);
              }}
              validationState={errors.username ? "error" : "default"}
              errorMessage={errors.username}
              hint={"This will be your public profile URL: winzy.ai/@" + (username.trim().toLowerCase() || "you")}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              testID="username-input"
            />

            <TextInput
              ref={passwordRef}
              label="Password"
              placeholder="At least 8 characters"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
                if (serverError) setServerError(null);
              }}
              validationState={errors.password ? "error" : "default"}
              errorMessage={errors.password}
              secureTextEntry
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              testID="password-input"
            />

            <Button
              title="Create account"
              onPress={handleSubmit}
              loading={loading}
              disabled={loading}
              size="lg"
            />
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              Already have an account?{" "}
            </Text>
            <Button
              title="Sign in"
              onPress={onNavigateToSignIn}
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
