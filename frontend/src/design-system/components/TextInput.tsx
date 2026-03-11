import React, { useState } from "react";
import {
  View,
  TextInput as RNTextInput,
  Text,
  StyleSheet,
  TextInputProps as RNTextInputProps,
} from "react-native";
import { spacing, radii } from "../tokens/spacing";
import { typography } from "../tokens/typography";
import { lightTheme } from "../tokens/colors";

type ValidationState = "default" | "error" | "success";

export type TextInputProps = Omit<RNTextInputProps, "style"> & {
  label?: string;
  hint?: string;
  errorMessage?: string;
  validationState?: ValidationState;
};

function getBorderColor(state: ValidationState, focused: boolean) {
  const colors = lightTheme;
  if (state === "error") return colors.error;
  if (state === "success") return colors.success;
  if (focused) return colors.borderFocused;
  return colors.border;
}

export function TextInput({
  label,
  hint,
  errorMessage,
  validationState = "default",
  ...inputProps
}: TextInputProps) {
  const [focused, setFocused] = useState(false);
  const colors = lightTheme;
  const showError = validationState === "error" && errorMessage;

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: colors.textPrimary }]} accessibilityRole="text">
          {label}
        </Text>
      )}
      <RNTextInput
        {...inputProps}
        style={[
          styles.input,
          {
            borderColor: getBorderColor(validationState, focused),
            backgroundColor: colors.surface,
            color: colors.textPrimary,
          },
          focused && styles.inputFocused,
        ]}
        placeholderTextColor={colors.textTertiary}
        onFocus={(e) => {
          setFocused(true);
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          inputProps.onBlur?.(e);
        }}
        accessibilityLabel={label ?? inputProps.accessibilityLabel}
      />
      {showError && (
        <Text style={[styles.hint, { color: colors.error }]} accessibilityRole="alert">
          {errorMessage}
        </Text>
      )}
      {!showError && hint && (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
  },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inputFocused: {
    borderWidth: 2,
  },
  hint: {
    ...typography.caption,
  },
});
