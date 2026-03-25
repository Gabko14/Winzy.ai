import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { radii } from "../tokens/spacing";
import { lightTheme } from "../tokens/colors";

export type AvatarSize = "sm" | "md" | "base" | "lg" | "xl";

export type AvatarProps = {
  initials: string;
  size?: AvatarSize;
  testID?: string;
};

const sizeMap: Record<AvatarSize, { container: number; fontSize: number }> = {
  sm: { container: 36, fontSize: 12 },
  md: { container: 44, fontSize: 16 },
  base: { container: 48, fontSize: 18 },
  lg: { container: 72, fontSize: 28 },
  xl: { container: 80, fontSize: 30 },
};

/**
 * Initials-in-circle avatar. Renders the given initials string
 * in a themed circle at the specified size.
 */
export function Avatar({ initials, size = "md", testID }: AvatarProps) {
  const colors = lightTheme;
  const dims = sizeMap[size];

  return (
    <View
      style={[
        styles.container,
        {
          width: dims.container,
          height: dims.container,
          borderRadius: radii.full,
          backgroundColor: colors.brandMuted,
        },
      ]}
      testID={testID}
    >
      <Text style={[styles.text, { fontSize: dims.fontSize, color: colors.brandPrimary }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontWeight: "600",
  },
});
