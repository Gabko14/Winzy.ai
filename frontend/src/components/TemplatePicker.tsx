import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { TEMPLATE_CATEGORIES, type HabitTemplate } from "../data/habitTemplates";

type Props = {
  onSelect: (template: HabitTemplate) => void;
  onSkip: () => void;
};

export function TemplatePicker({ onSelect, onSkip }: Props) {
  const colors = lightTheme;
  const [activeCategory, setActiveCategory] = useState(TEMPLATE_CATEGORIES[0]?.id ?? "");

  const currentCategory = TEMPLATE_CATEGORIES.find((c) => c.id === activeCategory);
  const templates = currentCategory?.templates ?? [];

  return (
    <View testID="template-picker">
      <Text style={[styles.heading, { color: colors.textPrimary }]}>
        Start with a template
      </Text>
      <Text style={[styles.subheading, { color: colors.textSecondary }]}>
        Pick one to get started, or create your own
      </Text>

      {/* Category tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabRow}
        testID="template-category-tabs"
      >
        {TEMPLATE_CATEGORIES.map((cat) => {
          const isActive = cat.id === activeCategory;
          return (
            <Pressable
              key={cat.id}
              onPress={() => setActiveCategory(cat.id)}
              style={[
                styles.tab,
                {
                  backgroundColor: isActive ? colors.brandPrimary : colors.backgroundSecondary,
                  borderColor: isActive ? colors.brandPrimary : colors.border,
                },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              testID={`template-tab-${cat.id}`}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: isActive ? colors.textInverse : colors.textPrimary },
                ]}
              >
                {cat.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Template cards */}
      <View style={styles.templateList} testID="template-list">
        {templates.map((template) => (
          <Pressable
            key={template.id}
            onPress={() => onSelect(template)}
            style={[styles.templateCard, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={`${template.name} template`}
            testID={`template-${template.id}`}
          >
            <View style={[styles.templateIcon, { backgroundColor: template.color + "1A" }]}>
              <Text style={styles.templateIconText}>{template.icon}</Text>
            </View>
            <View style={styles.templateInfo}>
              <Text style={[styles.templateName, { color: colors.textPrimary }]}>
                {template.name}
              </Text>
              <Text style={[styles.templateDesc, { color: colors.textSecondary }]}>
                {template.description}
              </Text>
            </View>
            <View style={[styles.frequencyBadge, { backgroundColor: colors.backgroundSecondary }]}>
              <Text style={[styles.frequencyText, { color: colors.textSecondary }]}>
                {template.frequency}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* Skip link */}
      <Pressable
        onPress={onSkip}
        style={styles.skipButton}
        accessibilityRole="button"
        testID="template-skip"
      >
        <Text style={[styles.skipText, { color: colors.brandPrimary }]}>
          Create custom habit
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    ...typography.h4,
    marginBottom: spacing.xs,
  },
  subheading: {
    ...typography.bodySmall,
    marginBottom: spacing.xl,
  },
  tabScroll: {
    marginBottom: spacing.base,
  },
  tabRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  tabText: {
    ...typography.label,
  },
  templateList: {
    gap: spacing.sm,
  },
  templateCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
  },
  templateIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  templateIconText: {
    fontSize: 22,
  },
  templateInfo: {
    flex: 1,
  },
  templateName: {
    ...typography.label,
    marginBottom: 2,
  },
  templateDesc: {
    ...typography.caption,
  },
  frequencyBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  frequencyText: {
    ...typography.caption,
  },
  skipButton: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  skipText: {
    ...typography.label,
  },
});
