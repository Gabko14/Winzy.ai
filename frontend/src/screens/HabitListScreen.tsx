import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { Button, Card, Badge, EmptyState, LoadingState, ErrorState } from "../design-system";
import { spacing, radii, typography, lightTheme } from "../design-system";
import { useHabits, useArchiveHabit } from "../hooks/useHabits";
import { useVisibility } from "../hooks/useVisibility";
import { visibilityLabel } from "../components/VisibilityPicker";
import { CreateHabitScreen } from "./CreateHabitScreen";
import type { Habit } from "../api/habits";

type Props = {
  onHabitCreated?: () => void;
  onBack?: () => void;
};

export function HabitListScreen({ onHabitCreated, onBack }: Props) {
  const colors = lightTheme;
  const { habits, loading, error, refresh } = useHabits();
  const { getVisibility, loading: visibilityLoading, error: visibilityError, refresh: refreshVisibility } = useVisibility();
  const [showCreate, setShowCreate] = useState(false);
  const [editHabit, setEditHabit] = useState<Habit | undefined>(undefined);

  const { archive } = useArchiveHabit(refresh);

  const handleCreate = useCallback(() => {
    setEditHabit(undefined);
    setShowCreate(true);
  }, []);

  const handleEdit = useCallback((habit: Habit) => {
    setEditHabit(habit);
    setShowCreate(true);
  }, []);

  const handleArchive = useCallback(
    (habit: Habit) => {
      const doArchive = async () => {
        try {
          await archive(habit.id);
        } catch {
          // Error state handled by the hook
        }
      };

      if (Platform.OS === "web") {
        if (window.confirm(`Archive "${habit.name}"? You can restore it later.`)) {
          doArchive();
        }
      } else {
        Alert.alert(
          "Archive habit",
          `Archive "${habit.name}"? You can restore it later.`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Archive", style: "destructive", onPress: doArchive },
          ],
        );
      }
    },
    [archive],
  );

  const handleSaved = useCallback(() => {
    refresh();
    refreshVisibility();
    setShowCreate(false);
    if (!editHabit) {
      onHabitCreated?.();
    }
  }, [refresh, refreshVisibility, editHabit, onHabitCreated]);

  const handleCloseModal = useCallback(() => {
    setShowCreate(false);
  }, []);

  const renderHabit = useCallback(
    ({ item }: { item: Habit }) => (
      <Card style={styles.habitCard}>
        <Pressable
          style={styles.habitRow}
          onPress={() => handleEdit(item)}
          onLongPress={() => handleArchive(item)}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.name}`}
          accessibilityHint="Long press to archive"
          testID={`habit-${item.id}`}
        >
          <View style={[styles.habitIcon, { backgroundColor: item.color ?? colors.brandMuted }]}>
            <Text style={styles.habitIconText}>{item.icon ?? "\u2B50"}</Text>
          </View>
          <View style={styles.habitInfo}>
            <Text style={[styles.habitName, { color: colors.textPrimary }]} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.habitMeta}>
              <Text style={[styles.habitFrequency, { color: colors.textSecondary }]}>
                {formatFrequency(item)}
              </Text>
              {!visibilityLoading && !visibilityError && (
                <Badge
                  label={visibilityLabel(getVisibility(item.id))}
                  variant={getVisibility(item.id) === "public" ? "info" : getVisibility(item.id) === "friends" ? "success" : "default"}
                  testID={`visibility-badge-${item.id}`}
                />
              )}
            </View>
          </View>
          <Pressable
            onPress={() => handleArchive(item)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Archive ${item.name}`}
            testID={`archive-${item.id}`}
          >
            <Text style={[styles.archiveLabel, { color: colors.textTertiary }]}>Archive</Text>
          </Pressable>
        </Pressable>
      </Card>
    ),
    [colors, handleEdit, handleArchive, getVisibility, visibilityLoading, visibilityError],
  );

  // Loading state
  if (loading && habits.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="habits-loading">
        <LoadingState message="Loading your habits..." />
      </View>
    );
  }

  // Error state
  if (error && habits.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="habits-error">
        <ErrorState message="Could not load your habits." onRetry={refresh} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="habit-list-screen">
      <View style={styles.header}>
        {onBack && (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton}>
            <Text style={[styles.backArrow, { color: colors.textPrimary }]}>←</Text>
          </Pressable>
        )}
        <Text style={[styles.title, { color: colors.textPrimary }]}>My Habits</Text>
        {habits.length > 0 && (
          <Button
            title="+ New"
            onPress={handleCreate}
            variant="ghost"
            size="sm"
            accessibilityLabel="Create new habit"
          />
        )}
      </View>

      {habits.length === 0 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            title="No habits yet"
            message="Start building habits that stick. Create your first one!"
            actionLabel="Create your first habit"
            onAction={handleCreate}
          />
        </View>
      ) : (
        <FlatList
          data={habits}
          keyExtractor={(item) => item.id}
          renderItem={renderHabit}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          testID="habits-list"
        />
      )}

      <CreateHabitScreen
        visible={showCreate}
        onClose={handleCloseModal}
        onSaved={handleSaved}
        editHabit={editHabit}
        editVisibility={editHabit ? getVisibility(editHabit.id) : undefined}
      />
    </View>
  );
}

function formatFrequency(habit: Habit): string {
  if (habit.frequency === "daily") return "Every day";
  if (habit.frequency === "weekly") return "Weekly";
  if (habit.frequency === "custom" && habit.customDays) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return habit.customDays.map((d) => dayNames[d]).join(", ");
  }
  return habit.frequency;
}

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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing.base,
  },
  title: {
    ...typography.h2,
    flex: 1,
  },
  backButton: {
    padding: spacing.sm,
    marginRight: spacing.sm,
  },
  backArrow: {
    fontSize: 24,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["3xl"],
    gap: spacing.md,
  },
  habitCard: {
    padding: 0,
  },
  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    gap: spacing.md,
  },
  habitIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  habitIconText: {
    fontSize: 22,
  },
  habitInfo: {
    flex: 1,
    gap: 2,
  },
  habitMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  habitName: {
    ...typography.body,
    fontWeight: "600",
  },
  habitFrequency: {
    ...typography.caption,
  },
  archiveLabel: {
    ...typography.caption,
    padding: spacing.xs,
  },
});
