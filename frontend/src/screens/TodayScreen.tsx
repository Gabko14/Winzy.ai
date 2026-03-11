import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
} from "react-native";
import {
  Card,
  EmptyState,
  LoadingState,
  ErrorState,
  Flame,
  Badge,
} from "../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../design-system";
import { useTodayHabits, type TodayHabit } from "../hooks/useTodayHabits";
import type { FlameLevel } from "../api/habits";

type Props = {
  onCreateHabit?: () => void;
  onHabitPress?: (habitId: string) => void;
};

export function TodayScreen({ onCreateHabit, onHabitPress }: Props) {
  const colors = lightTheme;
  const {
    items,
    loading,
    error,
    completing,
    completedCount,
    totalCount,
    refresh,
    toggleCompletion,
  } = useTodayHabits();

  const handleToggle = useCallback(
    (habitId: string) => {
      toggleCompletion(habitId);
    },
    [toggleCompletion],
  );

  const renderHabit = useCallback(
    ({ item }: { item: TodayHabit }) => (
      <HabitRow
        item={item}
        completing={completing.has(item.habit.id)}
        onToggle={handleToggle}
        onPress={onHabitPress}
      />
    ),
    [completing, handleToggle, onHabitPress],
  );

  const keyExtractor = useCallback((item: TodayHabit) => item.habit.id, []);

  // Loading state (initial load only)
  if (loading && items.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="today-loading">
        <LoadingState message="Loading your habits..." />
      </View>
    );
  }

  // Error state
  if (error && items.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="today-error">
        <ErrorState message={error.message} onRetry={refresh} />
      </View>
    );
  }

  // Empty state — no habits created yet
  if (!loading && items.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="today-empty">
        <DateHeader />
        <View style={styles.emptyContainer}>
          <EmptyState
            title="Ready to build a habit?"
            message="Small daily actions lead to big changes. Start with one habit and watch your flame grow."
            actionLabel="Create your first habit"
            onAction={onCreateHabit}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="today-screen">
      <DateHeader />

      {/* Progress summary */}
      <View style={styles.progressRow}>
        <Text style={[styles.progressText, { color: colors.textSecondary }]}>
          {completedCount} of {totalCount} done today
        </Text>
        {completedCount === totalCount && totalCount > 0 && (
          <Badge label="All done!" variant="success" />
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderHabit}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={colors.brandPrimary}
          />
        }
        testID="today-habits-list"
      />
    </View>
  );
}

// --- Date Header ---

function DateHeader() {
  const colors = lightTheme;
  const today = new Date();
  const dayName = today.toLocaleDateString(undefined, { weekday: "long" });
  const dateStr = today.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });

  return (
    <View style={styles.dateHeader}>
      <Text style={[styles.dayName, { color: colors.textPrimary }]}>{dayName}</Text>
      <Text style={[styles.dateStr, { color: colors.textSecondary }]}>{dateStr}</Text>
    </View>
  );
}

// --- Habit Row ---

type HabitRowProps = {
  item: TodayHabit;
  completing: boolean;
  onToggle: (habitId: string) => void;
  onPress?: (habitId: string) => void;
};

function HabitRow({ item, completing, onToggle, onPress }: HabitRowProps) {
  const colors = lightTheme;
  const { habit, completedToday, flameLevel, consistency } = item;

  return (
    <Card style={styles.habitCard}>
      <Pressable
        style={styles.habitRow}
        onPress={() => onPress?.(habit.id)}
        accessibilityRole="button"
        accessibilityLabel={`${habit.name}, ${completedToday ? "completed" : "not completed"}`}
        testID={`today-habit-${habit.id}`}
      >
        {/* Completion toggle */}
        <Pressable
          onPress={() => onToggle(habit.id)}
          disabled={completing}
          hitSlop={8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completedToday }}
          accessibilityLabel={`Mark ${habit.name} as ${completedToday ? "not done" : "done"}`}
          testID={`toggle-${habit.id}`}
        >
          <View
            style={[
              styles.checkbox,
              {
                backgroundColor: completedToday ? colors.success : "transparent",
                borderColor: completedToday ? colors.success : colors.border,
              },
              completing && styles.checkboxDisabled,
            ]}
          >
            {completedToday && (
              <Text style={styles.checkmark}>{"\u2713"}</Text>
            )}
          </View>
        </Pressable>

        {/* Habit icon */}
        <View style={[styles.habitIcon, { backgroundColor: habit.color ?? colors.brandMuted }]}>
          <Text style={styles.habitIconText}>{habit.icon ?? "\u2B50"}</Text>
        </View>

        {/* Habit info */}
        <View style={styles.habitInfo}>
          <Text
            style={[
              styles.habitName,
              { color: colors.textPrimary },
              completedToday && styles.habitNameCompleted,
            ]}
            numberOfLines={1}
          >
            {habit.name}
          </Text>
        </View>

        {/* Flame indicator */}
        <Flame flameLevel={flameLevel as FlameLevel} size="sm" consistency={consistency} />
      </Pressable>
    </Card>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
  },
  dateHeader: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing.sm,
  },
  dayName: {
    ...typography.h2,
  },
  dateStr: {
    ...typography.bodyLarge,
    marginTop: spacing.xs,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.base,
    gap: spacing.sm,
  },
  progressText: {
    ...typography.bodySmall,
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["3xl"],
    gap: spacing.md,
  },
  habitCard: {
    padding: 0,
    ...shadows.sm,
  },
  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    gap: spacing.md,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: radii.full,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxDisabled: {
    opacity: 0.5,
  },
  checkmark: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  habitIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  habitIconText: {
    fontSize: 20,
  },
  habitInfo: {
    flex: 1,
  },
  habitName: {
    ...typography.body,
    fontWeight: "600",
  },
  habitNameCompleted: {
    textDecorationLine: "line-through",
    opacity: 0.6,
  },
});
