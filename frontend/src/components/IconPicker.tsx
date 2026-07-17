import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput as RNTextInput } from "react-native";
import { spacing, radii, typography, lightTheme } from "../design-system";

export type IconCategory = {
  id: string;
  label: string;
  icons: string[];
};

/** Curated habit icons (~100), grouped for the expanded picker. */
export const ICON_CATEGORIES: IconCategory[] = [
  {
    id: "health",
    label: "Health",
    icons: [
      "💪", "🏃", "🏋️", "🚴", "🧘", "🤸", "🏊", "🚶", "🏃‍♀️", "🤸‍♂️",
      "⚽", "🏀", "🎾", "🧗", "⛷️", "🧊",
    ],
  },
  {
    id: "mind",
    label: "Mind",
    icons: [
      "🧠", "📚", "✍️", "📝", "📖", "🎯", "💡", "🧩", "🕯️", "🙏",
      "😌", "😴", "🌙", "☀️", "🌤️",
    ],
  },
  {
    id: "food",
    label: "Food",
    icons: [
      "🍎", "🥗", "🥦", "🥕", "🍇", "🍌", "🥑", "🥪", "🍲", "🍵",
      "☕", "💧", "🥛", "🧃", "🍽️",
    ],
  },
  {
    id: "learning",
    label: "Learning",
    icons: [
      "🎓", "💻", "🖥️", "📱", "🔬", "🔭", "🗺️", "🗣️", "🎧", "🎹",
      "🎨", "📷", "🎬", "📊",
    ],
  },
  {
    id: "home",
    label: "Home",
    icons: [
      "🏠", "🧹", "🧺", "🪴", "🛏️", "🛠️", "🔑", "📦", "🧼", "🪥",
      "🚿", "🐶", "🐱", "🌱",
    ],
  },
  {
    id: "social",
    label: "Social",
    icons: [
      "👋", "🤝", "💬", "📞", "💌", "🎁", "🎉", "🫂", "👨‍👩‍👧‍👦", "❤️",
      "⭐", "🌟",
    ],
  },
  {
    id: "misc",
    label: "Misc",
    icons: [
      "🔥", "✨", "🎵", "✈️", "🌍", "⏰", "💰", "🛒", "🎮", "🌳",
      "🏖️", "⛺", "🚀", "💎",
    ],
  },
];

const COLLAPSED_COUNT = 8;

export const ALL_CURATED_ICONS: string[] = ICON_CATEGORIES.flatMap((c) => c.icons);

export const DEFAULT_HABIT_ICON = ALL_CURATED_ICONS[0] ?? "💪";

const MAX_ICON_CHARS = 64;
const FALLBACK_MAX_UTF16 = 8;

export type CustomEmojiValidation =
  | { ok: true; emoji: string }
  | { ok: false; message: string };

function countGraphemes(value: string): number | null {
  const IntlObj = globalThis.Intl as typeof Intl | undefined;
  if (IntlObj && typeof IntlObj.Segmenter === "function") {
    const segmenter = new IntlObj.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value)).length;
  }
  return null;
}

function looksLikeEmoji(value: string): boolean {
  if (/[a-zA-Z0-9]/.test(value)) return false;
  try {
    return /\p{Extended_Pictographic}/u.test(value) || /\p{Emoji_Presentation}/u.test(value);
  } catch {
    for (const ch of value) {
      const cp = ch.codePointAt(0);
      if (cp !== undefined && cp > 0x7f) return true;
    }
    return /[\u2600-\u27BF\u2300-\u23FF]/.test(value);
  }
}

/**
 * Validiert eine einzelne Emoji-Eingabe.
 * Intl.Segmenter (Grapheme) wenn verfuegbar (Browser / RN-Web);
 * Hermes hat kein Segmenter — Fallback: <=8 UTF-16-Einheiten + Emoji-Muster.
 */
export function validateCustomEmoji(raw: string): CustomEmojiValidation {
  const value = raw.trim();
  if (!value) {
    return { ok: false, message: "Enter a single emoji." };
  }
  if (value.length > MAX_ICON_CHARS) {
    return { ok: false, message: "That emoji is too long." };
  }

  const graphemes = countGraphemes(value);
  if (graphemes !== null) {
    if (graphemes !== 1) {
      return { ok: false, message: "Please enter only one emoji." };
    }
    if (!looksLikeEmoji(value)) {
      return { ok: false, message: "That doesn't look like an emoji." };
    }
    return { ok: true, emoji: value };
  }

  if (value.length > FALLBACK_MAX_UTF16) {
    return { ok: false, message: "Please enter only one emoji." };
  }
  if (!looksLikeEmoji(value)) {
    return { ok: false, message: "That doesn't look like an emoji." };
  }
  return { ok: true, emoji: value };
}

export function isCuratedIcon(icon: string): boolean {
  return ALL_CURATED_ICONS.includes(icon);
}

export type IconPickerProps = {
  value: string;
  onChange: (icon: string) => void;
  disabled?: boolean;
};

export function IconPicker({ value, onChange, disabled }: IconPickerProps) {
  const colors = lightTheme;
  const [expanded, setExpanded] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  const curatedSelected = isCuratedIcon(value);
  const collapsedIcons = useMemo(() => {
    const base = ALL_CURATED_ICONS.slice(0, COLLAPSED_COUNT);
    if (!curatedSelected && value && !base.includes(value)) {
      return [value, ...base.slice(0, COLLAPSED_COUNT - 1)];
    }
    return base;
  }, [curatedSelected, value]);

  const applyCustom = () => {
    const result = validateCustomEmoji(customDraft);
    if (!result.ok) {
      setCustomError(result.message);
      return;
    }
    setCustomError(null);
    setCustomDraft("");
    onChange(result.emoji);
  };

  const renderIconButton = (emoji: string) => {
    const selected = value === emoji;
    return (
      <Pressable
        key={emoji}
        onPress={() => {
          if (!disabled) onChange(emoji);
        }}
        disabled={disabled}
        style={[
          styles.iconOption,
          {
            backgroundColor: selected ? colors.brandMuted : colors.backgroundSecondary,
            borderColor: selected ? colors.brandPrimary : "transparent",
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled }}
        accessibilityLabel={`Icon ${emoji}`}
        testID={`icon-${emoji}`}
      >
        <Text style={styles.iconText}>{emoji}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.section} testID="icon-picker">
      <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>Icon</Text>

      {!expanded ? (
        <View style={styles.grid} testID="icon-picker-collapsed">
          {collapsedIcons.map(renderIconButton)}
          <Pressable
            onPress={() => {
              if (!disabled) setExpanded(true);
            }}
            disabled={disabled}
            style={[
              styles.iconOption,
              styles.moreButton,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: colors.border,
                opacity: disabled ? 0.5 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Show more icons"
            testID="icon-picker-expand"
          >
            <Text style={[styles.moreText, { color: colors.textSecondary }]}>⋯</Text>
          </Pressable>
        </View>
      ) : (
        <View testID="icon-picker-expanded">
          <ScrollView
            style={styles.expandedScroll}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {ICON_CATEGORIES.map((category) => (
              <View key={category.id} style={styles.categoryBlock} testID={`icon-category-${category.id}`}>
                <Text style={[styles.categoryLabel, { color: colors.textSecondary }]}>
                  {category.label}
                </Text>
                <View style={styles.grid}>{category.icons.map(renderIconButton)}</View>
              </View>
            ))}
          </ScrollView>
          <Pressable
            onPress={() => setExpanded(false)}
            style={styles.collapseRow}
            accessibilityRole="button"
            accessibilityLabel="Show fewer icons"
            testID="icon-picker-collapse"
          >
            <Text style={[styles.collapseText, { color: colors.brandPrimary }]}>Show less</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.customRow} testID="icon-picker-custom">
        <RNTextInput
          value={customDraft}
          onChangeText={(text) => {
            setCustomDraft(text);
            if (customError) setCustomError(null);
          }}
          placeholder="Or paste any emoji"
          placeholderTextColor={colors.textTertiary}
          editable={!disabled}
          maxLength={MAX_ICON_CHARS}
          style={[
            styles.customInput,
            {
              borderColor: customError ? colors.error : colors.border,
              backgroundColor: colors.surface,
              color: colors.textPrimary,
              opacity: disabled ? 0.5 : 1,
            },
          ]}
          accessibilityLabel="Custom emoji"
          testID="icon-custom-input"
          onSubmitEditing={applyCustom}
        />
        <Pressable
          onPress={applyCustom}
          disabled={disabled}
          style={[
            styles.customApply,
            {
              backgroundColor: colors.brandPrimary,
              opacity: disabled ? 0.5 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Use custom emoji"
          testID="icon-custom-apply"
        >
          <Text style={[styles.customApplyText, { color: colors.textInverse }]}>Use</Text>
        </Pressable>
      </View>
      {customError ? (
        <Text style={[styles.customError, { color: colors.error }]} testID="icon-custom-error">
          {customError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
  },
  sectionLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  iconOption: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 22,
  },
  moreButton: {
    borderWidth: 1,
  },
  moreText: {
    fontSize: 20,
    fontWeight: "700",
  },
  expandedScroll: {
    maxHeight: 220,
  },
  categoryBlock: {
    marginBottom: spacing.md,
  },
  categoryLabel: {
    ...typography.caption,
    marginBottom: spacing.xs,
    fontWeight: "600",
  },
  collapseRow: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  collapseText: {
    ...typography.label,
  },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 18,
    minHeight: 44,
  },
  customApply: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    minHeight: 44,
    justifyContent: "center",
  },
  customApplyText: {
    ...typography.label,
    fontWeight: "600",
  },
  customError: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
});
