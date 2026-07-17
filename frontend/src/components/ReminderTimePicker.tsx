import React, { createElement } from "react";
import { Platform, Pressable, Text, StyleSheet, View } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { spacing, typography, lightTheme, radii } from "../design-system";

const DEFAULT_TIME = "19:00";

type Props = {
  value: string;
  onChange: (hhmm: string) => void;
  disabled?: boolean;
  testID?: string;
};

function parseHHMM(value: string): Date {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hours = match ? Number(match[1]) : 19;
  const minutes = match ? Number(match[2]) : 0;
  const date = new Date();
  date.setHours(
    Number.isFinite(hours) ? hours : 19,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
  return date;
}

function formatHHMM(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function ReminderTimePicker({
  value,
  onChange,
  disabled = false,
  testID = "reminder-time-picker",
}: Props) {
  const colors = lightTheme;
  const normalized = /^\d{1,2}:\d{2}$/.test(value.trim()) ? value.trim() : DEFAULT_TIME;

  if (Platform.OS === "web") {
    return (
      <View testID={testID}>
        {createElement("input", {
          type: "time",
          value: normalized,
          disabled,
          onChange: (event: { target: { value: string } }) => {
            const next = event.target.value?.slice(0, 5);
            if (next) onChange(next);
          },
          "aria-label": "Reminder time",
          style: {
            fontSize: 16,
            padding: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.textPrimary,
            backgroundColor: colors.surface,
            maxWidth: 140,
          },
        })}
      </View>
    );
  }

  if (Platform.OS === "android") {
    return (
      <Pressable
        testID={testID}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Reminder time"
        onPress={() => {
          DateTimePickerAndroid.open({
            value: parseHHMM(normalized),
            mode: "time",
            is24Hour: true,
            onChange: (event, date) => {
              if (event.type === "set" && date) {
                onChange(formatHHMM(date));
              }
            },
          });
        }}
        style={[
          styles.androidButton,
          { borderColor: colors.border, backgroundColor: colors.surface },
          disabled && styles.disabled,
        ]}
      >
        <Text style={[styles.androidLabel, { color: colors.textPrimary }]}>{normalized}</Text>
      </Pressable>
    );
  }

  return (
    <View testID={testID}>
      <DateTimePicker
        value={parseHHMM(normalized)}
        mode="time"
        display="compact"
        disabled={disabled}
        onChange={(_event, date) => {
          if (date) onChange(formatHHMM(date));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  androidButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  androidLabel: {
    ...typography.body,
    fontWeight: "500",
  },
  disabled: {
    opacity: 0.5,
  },
});
