import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, radii } from '../tokens/spacing';
import { typography } from '../tokens/typography';
import { lightTheme, semantic } from '../tokens/colors';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export type BadgeProps = {
  label: string;
  variant?: BadgeVariant;
};

const variantColors: Record<BadgeVariant, { bg: string; text: string }> = {
  default: { bg: lightTheme.backgroundSecondary, text: lightTheme.textSecondary },
  success: { bg: semantic.successLight, text: semantic.success },
  warning: { bg: semantic.warningLight, text: semantic.warning },
  error: { bg: semantic.errorLight, text: semantic.error },
  info: { bg: semantic.infoLight, text: semantic.info },
};

export function Badge({ label, variant = 'default' }: BadgeProps) {
  const colors = variantColors[variant];

  return (
    <View
      style={[styles.badge, { backgroundColor: colors.bg }]}
      accessibilityRole="text"
    >
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  label: {
    ...typography.caption,
    fontWeight: '600',
  },
});
