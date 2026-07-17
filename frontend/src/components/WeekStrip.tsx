import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { spacing, typography, lightTheme } from "../design-system";
import type { CompletionDayEntry, CompletionKind, Habit } from "../api/habits";
import {
  addDaysISO,
  isHabitDueOnDate,
  weekdayInitial,
} from "../utils/completionCycle";

const MINIMUM_COLOR = "#F59E0B";
const CELL_SIZE = 44;
const DOT_SIZE = 8;

type Props = {
  habit: Habit;
  weekDays: CompletionDayEntry[];
  today: string;
  completing: Set<string>;
  onToggleDay: (habitId: string, date: string) => void;
};

type CellModel = {
  date: string;
  kind: CompletionKind | null;
  due: boolean;
  isToday: boolean;
  isFuture: boolean;
};

export function WeekStrip({ habit, weekDays, today, completing, onToggleDay }: Props) {
  const colors = lightTheme;

  const cells = useMemo((): CellModel[] => {
    const byDate = new Map(weekDays.map((d) => [d.date, d]));
    const out: CellModel[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = addDaysISO(today, -i);
      const entry = byDate.get(date);
      out.push({
        date,
        kind: (entry?.completionKind ?? null) as CompletionKind | null,
        due: isHabitDueOnDate(habit.frequency, habit.customDays, date),
        isToday: date === today,
        isFuture: date > today,
      });
    }
    return out;
  }, [weekDays, today, habit.frequency, habit.customDays]);

  return (
    <View style={styles.row} testID={`week-strip-${habit.id}`}>
      {cells.map((cell) => {
        const busy = completing.has(`${habit.id}:${cell.date}`);
        const disabled = cell.isFuture || busy;
        const filled = cell.kind != null;
        const isMin = cell.kind === "minimum";
        const dotColor = filled
          ? isMin
            ? MINIMUM_COLOR
            : colors.success
          : "transparent";
        const borderColor = filled
          ? isMin
            ? MINIMUM_COLOR
            : colors.success
          : colors.border;
        const muted = !cell.due && !filled;

        return (
          <Pressable
            key={cell.date}
            onPress={() => onToggleDay(habit.id, cell.date)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled, checked: filled }}
            accessibilityLabel={`${weekdayInitial(cell.date)} ${cell.date}${
              cell.isToday ? ", today" : ""
            }${filled ? (isMin ? ", minimum" : ", completed") : ", not completed"}${
              !cell.due ? ", not due" : ""
            }`}
            style={[styles.cell, disabled && styles.cellDisabled]}
            testID={`week-cell-${habit.id}-${cell.date}`}
          >
            <Text
              style={[
                styles.initial,
                {
                  color: muted ? colors.textTertiary : colors.textSecondary,
                  fontWeight: cell.isToday ? "700" : "500",
                },
              ]}
            >
              {weekdayInitial(cell.date)}
            </Text>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: muted ? colors.border : dotColor,
                  borderColor: muted ? colors.border : borderColor,
                  opacity: muted ? 0.45 : 1,
                },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    paddingTop: 0,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  cellDisabled: {
    opacity: 0.35,
  },
  initial: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 12,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 1.5,
  },
});
