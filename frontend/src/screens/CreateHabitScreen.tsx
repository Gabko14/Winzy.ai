import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { Button, TextInput, Modal } from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { isApiError } from "../api";
import { useCreateHabit, useUpdateHabit } from "../hooks/useHabits";
import { validateHabitName, validateCustomDays } from "../utils/habitValidation";
import type { Habit, FrequencyType, CreateHabitRequest, UpdateHabitRequest } from "../api/habits";

// --- Preset options ---

const HABIT_ICONS = [
  "\uD83D\uDCAA", "\uD83C\uDFC3", "\uD83D\uDCD6", "\uD83E\uDDD8", "\uD83D\uDCA4",
  "\uD83D\uDCA7", "\uD83C\uDF4E", "\u2708\uFE0F", "\uD83C\uDFB5", "\uD83C\uDFA8",
  "\u2615", "\uD83D\uDCBB", "\uD83C\uDFCB\uFE0F", "\uD83D\uDEB4", "\uD83E\uDD62",
  "\uD83D\uDE4F", "\uD83C\uDF1E", "\u270D\uFE0F", "\uD83D\uDEBF", "\uD83C\uDF3F",
];

const HABIT_COLORS = [
  "#F97316", "#EF4444", "#EC4899", "#8B5CF6", "#6366F1",
  "#3B82F6", "#06B6D4", "#14B8A6", "#22C55E", "#84CC16",
  "#EAB308", "#F59E0B",
];

const FREQUENCY_OPTIONS: { value: FrequencyType; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: (habit: Habit) => void;
  editHabit?: Habit;
};

export function CreateHabitScreen({ visible, onClose, onSaved, editHabit }: Props) {
  const colors = lightTheme;
  const isEditing = !!editHabit;

  // --- Form state ---
  const [name, setName] = useState(editHabit?.name ?? "");
  const [icon, setIcon] = useState(editHabit?.icon ?? HABIT_ICONS[0]);
  const [color, setColor] = useState(editHabit?.color ?? HABIT_COLORS[0]);
  const [frequency, setFrequency] = useState<FrequencyType>(editHabit?.frequency ?? "daily");
  const [customDays, setCustomDays] = useState<number[]>(editHabit?.customDays ?? []);

  const [errors, setErrors] = useState<{ name?: string; customDays?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset form when modal opens with different habit
  const resetForm = useCallback(() => {
    setName(editHabit?.name ?? "");
    setIcon(editHabit?.icon ?? HABIT_ICONS[0]);
    setColor(editHabit?.color ?? HABIT_COLORS[0]);
    setFrequency(editHabit?.frequency ?? "daily");
    setCustomDays(editHabit?.customDays ?? []);
    setErrors({});
    setServerError(null);
  }, [editHabit]);

  // Reset when modal becomes visible
  React.useEffect(() => {
    if (visible) resetForm();
  }, [visible, resetForm]);

  const handleSaved = useCallback(
    (habit: Habit) => {
      onSaved(habit);
      onClose();
    },
    [onSaved, onClose],
  );

  const { loading: creating, create } = useCreateHabit(handleSaved);
  const { loading: updating, update } = useUpdateHabit(handleSaved);
  const loading = creating || updating;

  // --- Validation ---
  const validateForm = useCallback((): boolean => {
    const nameError = validateHabitName(name);
    const daysError = validateCustomDays(frequency, customDays);
    const newErrors: typeof errors = {};
    if (nameError) newErrors.name = nameError;
    if (daysError) newErrors.customDays = daysError;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, frequency, customDays]);

  // --- Submit ---
  const handleSubmit = useCallback(async () => {
    setServerError(null);
    if (!validateForm()) return;

    try {
      if (isEditing && editHabit) {
        const request: UpdateHabitRequest = {
          name: name.trim(),
          icon,
          color,
          frequency,
          ...(frequency === "custom" ? { customDays } : {}),
        };
        await update(editHabit.id, request);
      } else {
        const request: CreateHabitRequest = {
          name: name.trim(),
          icon,
          color,
          frequency,
          ...(frequency === "custom" ? { customDays } : {}),
        };
        await create(request);
      }
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === "validation" && err.validationErrors) {
          const fieldErrors: typeof errors = {};
          if (err.validationErrors.name) fieldErrors.name = err.validationErrors.name[0];
          setErrors(fieldErrors);
        } else if (err.code === "network") {
          setServerError("Unable to reach the server. Please check your connection.");
        } else {
          setServerError(err.message);
        }
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  }, [name, icon, color, frequency, customDays, isEditing, editHabit, create, update, validateForm]);

  // --- Custom day toggle ---
  const toggleDay = useCallback((day: number) => {
    setCustomDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
    setErrors((e) => ({ ...e, customDays: undefined }));
  }, []);

  const title = isEditing ? "Edit Habit" : "New Habit";
  const submitLabel = isEditing ? "Save changes" : "Create habit";

  // Memoize day selection set for O(1) lookups in render
  const selectedDaysSet = useMemo(() => new Set(customDays), [customDays]);

  return (
    <Modal visible={visible} onClose={onClose} title={title}>
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {serverError && (
          <View
            style={[styles.errorBanner, { backgroundColor: colors.errorBackground }]}
            accessibilityRole="alert"
            testID="server-error"
          >
            <Text style={[styles.errorText, { color: colors.error }]}>{serverError}</Text>
          </View>
        )}

        {/* Name */}
        <TextInput
          label="Habit name"
          placeholder="e.g. Morning run, Read 30 min"
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
            if (serverError) setServerError(null);
          }}
          validationState={errors.name ? "error" : "default"}
          errorMessage={errors.name}
          autoCapitalize="sentences"
          autoCorrect
          returnKeyType="done"
          maxLength={256}
          testID="habit-name-input"
        />

        {/* Icon picker */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>Icon</Text>
          <View style={styles.grid} testID="icon-picker">
            {HABIT_ICONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => setIcon(emoji)}
                style={[
                  styles.iconOption,
                  {
                    backgroundColor: icon === emoji ? colors.brandMuted : colors.backgroundSecondary,
                    borderColor: icon === emoji ? colors.brandPrimary : "transparent",
                  },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: icon === emoji }}
                accessibilityLabel={`Icon ${emoji}`}
                testID={`icon-${emoji}`}
              >
                <Text style={styles.iconText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Color picker */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>Color</Text>
          <View style={styles.grid} testID="color-picker">
            {HABIT_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[
                  styles.colorOption,
                  { backgroundColor: c },
                  color === c && styles.colorSelected,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: color === c }}
                accessibilityLabel={`Color ${c}`}
                testID={`color-${c}`}
              >
                {color === c && <Text style={styles.colorCheck}>{"\u2713"}</Text>}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Frequency selector */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>Frequency</Text>
          <View style={styles.frequencyRow} testID="frequency-picker">
            {FREQUENCY_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => {
                  setFrequency(opt.value);
                  if (errors.customDays) setErrors((e) => ({ ...e, customDays: undefined }));
                }}
                style={[
                  styles.frequencyOption,
                  {
                    backgroundColor: frequency === opt.value ? colors.brandPrimary : colors.backgroundSecondary,
                    borderColor: frequency === opt.value ? colors.brandPrimary : colors.border,
                  },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: frequency === opt.value }}
                testID={`freq-${opt.value}`}
              >
                <Text
                  style={[
                    styles.frequencyText,
                    { color: frequency === opt.value ? colors.textInverse : colors.textPrimary },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Custom days picker */}
        {frequency === "custom" && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>Days</Text>
            <View style={styles.daysRow} testID="days-picker">
              {DAY_LABELS.map((label, i) => (
                <Pressable
                  key={label}
                  onPress={() => toggleDay(i)}
                  style={[
                    styles.dayOption,
                    {
                      backgroundColor: selectedDaysSet.has(i) ? colors.brandPrimary : colors.backgroundSecondary,
                      borderColor: selectedDaysSet.has(i) ? colors.brandPrimary : colors.border,
                    },
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selectedDaysSet.has(i) }}
                  accessibilityLabel={label}
                  testID={`day-${label}`}
                >
                  <Text
                    style={[
                      styles.dayText,
                      { color: selectedDaysSet.has(i) ? colors.textInverse : colors.textPrimary },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {errors.customDays && (
              <Text style={[styles.fieldError, { color: colors.error }]} accessibilityRole="alert">
                {errors.customDays}
              </Text>
            )}
          </View>
        )}

        {/* Submit */}
        <View style={styles.submitSection}>
          <Button
            title={submitLabel}
            onPress={handleSubmit}
            loading={loading}
            disabled={loading}
            size="lg"
          />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scroll: {
    maxHeight: 500,
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
  colorOption: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  colorSelected: {
    borderWidth: 3,
    borderColor: "#FFFFFF",
    // Outer ring effect via shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  colorCheck: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  frequencyRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  frequencyOption: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
  },
  frequencyText: {
    ...typography.label,
  },
  daysRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  dayOption: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
  },
  dayText: {
    ...typography.caption,
    fontWeight: "600",
  },
  fieldError: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  submitSection: {
    marginTop: spacing["2xl"],
  },
});
