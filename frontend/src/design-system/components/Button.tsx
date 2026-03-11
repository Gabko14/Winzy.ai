import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
} from 'react-native';
import { spacing, radii } from '../tokens/spacing';
import { typography } from '../tokens/typography';
import { lightTheme } from '../tokens/colors';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
};

const sizeStyles: Record<ButtonSize, { container: ViewStyle; text: TextStyle }> = {
  sm: {
    container: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.base,
    },
    text: typography.buttonSmall,
  },
  md: {
    container: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xl,
    },
    text: typography.button,
  },
  lg: {
    container: {
      paddingVertical: spacing.base,
      paddingHorizontal: spacing['2xl'],
    },
    text: { ...typography.button, fontSize: 18 },
  },
};

function getVariantStyles(variant: ButtonVariant, pressed: boolean) {
  const colors = lightTheme;
  const base: { container: ViewStyle; text: TextStyle } = {
    container: {},
    text: {},
  };

  switch (variant) {
    case 'primary':
      base.container = {
        backgroundColor: pressed ? colors.brandSecondary : colors.brandPrimary,
      };
      base.text = { color: colors.textInverse };
      break;
    case 'secondary':
      base.container = {
        backgroundColor: pressed ? colors.backgroundSecondary : 'transparent',
        borderWidth: 1,
        borderColor: colors.border,
      };
      base.text = { color: colors.textPrimary };
      break;
    case 'ghost':
      base.container = {
        backgroundColor: pressed ? colors.backgroundSecondary : 'transparent',
      };
      base.text = { color: colors.brandPrimary };
      break;
  }

  return base;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  accessibilityLabel,
}: ButtonProps) {
  const sizeStyle = sizeStyles[size];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || loading }}
      style={({ pressed }) => {
        const variantStyle = getVariantStyles(variant, pressed);
        return [
          styles.base,
          sizeStyle.container,
          variantStyle.container,
          disabled && styles.disabled,
        ];
      }}
    >
      {({ pressed }) => {
        const variantStyle = getVariantStyles(variant, pressed);
        return loading ? (
          <ActivityIndicator
            size="small"
            color={variant === 'primary' ? lightTheme.textInverse : lightTheme.brandPrimary}
          />
        ) : (
          <Text
            style={[sizeStyle.text, variantStyle.text, disabled && styles.disabledText]}
          >
            {title}
          </Text>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  disabled: {
    opacity: 0.5,
  },
  disabledText: {
    opacity: 0.7,
  },
});
