import React from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { spacing, lightTheme, typography } from "../design-system";
import { UnreadBadge } from "../components/notifications";

export type TabId = "today" | "friends" | "feed" | "profile";

export type TabDefinition = {
  id: TabId;
  label: string;
  icon: string;
  badge?: number;
};

type Props = {
  tabs: TabDefinition[];
  activeTab: TabId;
  onTabPress: (tabId: TabId) => void;
};

export function TabBar({ tabs, activeTab, onTabPress }: Props) {
  const colors = lightTheme;

  return (
    <View
      style={[styles.container, { backgroundColor: colors.surface, borderTopColor: colors.border }]}
      testID="tab-bar"
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onTabPress(tab.id)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={
              tab.badge && tab.badge > 0
                ? `${tab.label}, ${tab.badge} unread`
                : tab.label
            }
            testID={`tab-${tab.id}`}
          >
            <View style={styles.iconContainer}>
              <Text
                style={[
                  styles.icon,
                  { color: isActive ? colors.brandPrimary : colors.textTertiary },
                ]}
              >
                {tab.icon}
              </Text>
              {tab.badge != null && tab.badge > 0 && (
                <View style={styles.badgeOverlay}>
                  <UnreadBadge count={tab.badge} />
                </View>
              )}
            </View>
            <Text
              style={[
                styles.label,
                { color: isActive ? colors.brandPrimary : colors.textTertiary },
                isActive && styles.labelActive,
              ]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderTopWidth: 1,
    paddingBottom: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  iconContainer: {
    position: "relative",
    marginBottom: spacing.xs,
  },
  icon: {
    fontSize: 22,
  },
  badgeOverlay: {
    position: "absolute",
    top: -4,
    right: -10,
  },
  label: {
    ...typography.caption,
  },
  labelActive: {
    fontWeight: "600",
  },
});
