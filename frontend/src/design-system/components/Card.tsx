import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { spacing, radii, shadows } from '../tokens/spacing';
import { lightTheme } from '../tokens/colors';

export type CardProps = {
  children: React.ReactNode;
  elevated?: boolean;
  style?: ViewStyle;
};

export function Card({ children, elevated = false, style }: CardProps) {
  const colors = lightTheme;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: elevated ? colors.surfaceElevated : colors.surface,
          borderColor: colors.border,
        },
        elevated && shadows.md,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
});
