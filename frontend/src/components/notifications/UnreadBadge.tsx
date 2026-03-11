import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { radii } from "../../design-system/tokens/spacing";
import { lightTheme } from "../../design-system/tokens/colors";

export type UnreadBadgeProps = {
  count: number;
};

export function UnreadBadge({ count }: UnreadBadgeProps) {
  if (count <= 0) return null;

  const colors = lightTheme;
  const label = count > 99 ? "99+" : String(count);

  return (
    <View
      style={[styles.badge, { backgroundColor: colors.brandPrimary }]}
      accessibilityLabel={`${count} unread notification${count === 1 ? "" : "s"}`}
      accessibilityRole="text"
      testID="unread-badge"
    >
      <Text style={[styles.label, { color: colors.textInverse }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
    textAlign: "center",
  },
});
