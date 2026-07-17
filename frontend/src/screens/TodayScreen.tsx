import React, { useCallback, useMemo, useState } from "react";
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
  InlineError,
} from "../design-system";
import { spacing, radii, typography, lightTheme, shadows } from "../design-system";
import { useTodayHabits, type TodayHabit } from "../hooks/useTodayHabits";
import { useOrderHabits } from "../hooks/useHabits";
import { UnreadBadge } from "../components/notifications";
import { WeekStrip } from "../components/WeekStrip";
import { TodayTodosSection } from "../components/TodayTodosSection";
import { isApiError } from "../api";
import type { Habit, FlameLevel, CompletionKind } from "../api/habits";

type Props = {
  onCreateHabit?: () => void;
  onHabitPress?: (habitId: string) => void;
  onNotifications?: () => void;
  onManageTodos?: () => void;
  unreadNotificationCount?: number;
};

export function TodayScreen({
  onCreateHabit,
  onHabitPress,
  onNotifications,
  onManageTodos,
  unreadNotificationCount,
}: Props) {
  const colors = lightTheme;
  const {
    items,
    notTodayHabits,
    allHabits,
    hasAnyHabits,
    loading,
    error,
    completing,
    completedCount,
    totalCount,
    today,
    undo,
    refresh,
    toggleCompletion,
    toggleDay,
    undoLast,
    dismissUndo,
  } = useTodayHabits();
  const { order } = useOrderHabits();

  const [reorderMode, setReorderMode] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [committingOrder, setCommittingOrder] = useState(false);

  const reorderHabits = useMemo(() => {
    if (!reorderMode) return [];
    const byId = new Map(allHabits.map((h) => [h.id, h]));
    return draftIds.map((id) => byId.get(id)).filter((h): h is Habit => !!h);
  }, [reorderMode, allHabits, draftIds]);

  const enterReorder = useCallback(() => {
    setDraftIds(allHabits.map((h) => h.id));
    setOrderError(null);
    setOverflowOpen(false);
    setReorderMode(true);
  }, [allHabits]);

  const cancelReorder = useCallback(() => {
    setReorderMode(false);
    setDraftIds([]);
    setOrderError(null);
  }, []);

  const move = useCallback((id: string, dir: -1 | 1) => {
    setDraftIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[idx];
      next[idx] = next[nextIdx];
      next[nextIdx] = tmp;
      return next;
    });
  }, []);

  const commitReorder = useCallback(async () => {
    setCommittingOrder(true);
    setOrderError(null);
    try {
      await order(draftIds);
      setReorderMode(false);
      setDraftIds([]);
    } catch (err) {
      const message = isApiError(err)
        ? err.message
        : "Could not save order. The list was refreshed.";
      setOrderError(message);
      await refresh();
      setReorderMode(false);
      setDraftIds([]);
    } finally {
      setCommittingOrder(false);
    }
  }, [draftIds, order, refresh]);

  const handleToggle = useCallback(
    (habitId: string, kind?: CompletionKind) => {
      toggleCompletion(habitId, kind);
    },
    [toggleCompletion],
  );

  const handleToggleDay = useCallback(
    (habitId: string, date: string) => {
      toggleDay(habitId, date);
    },
    [toggleDay],
  );

  const renderHabit = useCallback(
    ({ item }: { item: TodayHabit }) => (
      <HabitRow
        item={item}
        today={today}
        completing={completing}
        onToggle={handleToggle}
        onToggleDay={handleToggleDay}
        onPress={onHabitPress}
      />
    ),
    [today, completing, handleToggle, handleToggleDay, onHabitPress],
  );

  const renderReorderHabit = useCallback(
    ({ item, index }: { item: Habit; index: number }) => (
      <ReorderHabitRow
        habit={item}
        index={index}
        total={reorderHabits.length}
        onMoveUp={() => move(item.id, -1)}
        onMoveDown={() => move(item.id, 1)}
      />
    ),
    [reorderHabits.length, move],
  );

  const keyExtractor = useCallback((item: TodayHabit) => item.habit.id, []);
  const reorderKeyExtractor = useCallback((item: Habit) => item.id, []);

  const listFooter = (
    <>
      <NotTodaySection habits={notTodayHabits} onPress={onHabitPress} />
      <TodayTodosSection onManage={onManageTodos} />
    </>
  );

  // Loading state (initial load only)
  if (loading && !hasAnyHabits) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="today-loading">
        <LoadingState message="Loading your habits..." />
      </View>
    );
  }

  // Error state
  if (error && !hasAnyHabits) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="today-error">
        <ErrorState message={error.message} onRetry={refresh} />
      </View>
    );
  }

  // Empty state — no habits created yet
  if (!loading && !hasAnyHabits) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]} testID="today-empty">
        <DateHeader onNotifications={onNotifications} unreadCount={unreadNotificationCount} />
        <View style={styles.emptyContainer}>
          <EmptyState
            title="Ready to build a habit?"
            message="Small daily actions lead to big changes. Start with one habit and watch your flame grow."
            actionLabel="Create your first habit"
            onAction={onCreateHabit}
          />
        </View>
        <View style={styles.todosEmptyPad}>
          <TodayTodosSection onManage={onManageTodos} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="today-screen">
      <DateHeader onNotifications={onNotifications} unreadCount={unreadNotificationCount} />

      {/* Create habit FAB — hidden in reorder mode */}
      {onCreateHabit && !reorderMode && (
        <Pressable
          onPress={onCreateHabit}
          style={[styles.fab, { backgroundColor: colors.brandPrimary }]}
          accessibilityRole="button"
          accessibilityLabel="Create a new habit"
          testID="create-habit-fab"
        >
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      )}

      {/* Progress summary / reorder chrome */}
      <View style={styles.progressRow}>
        {reorderMode ? (
          <>
            <Text style={[styles.progressText, { color: colors.textSecondary }]}>
              Reorder habits
            </Text>
            <View style={styles.headerActions}>
              <Pressable onPress={cancelReorder} testID="habits-reorder-cancel" hitSlop={8}>
                <Text style={[styles.headerAction, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={commitReorder}
                disabled={committingOrder}
                testID="habits-reorder-done"
                hitSlop={8}
              >
                <Text style={[styles.headerAction, { color: colors.brandPrimary }]}>
                  {committingOrder ? "Saving…" : "Done"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.progressText, { color: colors.textSecondary }]}>
              {completedCount} of {totalCount} done today
            </Text>
            <View style={styles.progressTrailing}>
              {completedCount === totalCount && totalCount > 0 && (
                <Badge label="All done!" variant="success" />
              )}
              {allHabits.length >= 2 && (
                <View style={styles.overflowWrap}>
                  <Pressable
                    onPress={() => setOverflowOpen((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel="Habit options"
                    accessibilityState={{ expanded: overflowOpen }}
                    testID="habits-overflow"
                    hitSlop={8}
                    style={styles.overflowBtn}
                  >
                    <Text style={[styles.overflowGlyph, { color: colors.textTertiary }]}>
                      {"\u22EF"}
                    </Text>
                  </Pressable>
                  {overflowOpen && (
                    <View
                      style={[
                        styles.overflowMenu,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                      testID="habits-overflow-menu"
                    >
                      <Pressable
                        onPress={enterReorder}
                        accessibilityRole="button"
                        accessibilityLabel="Reorder habits"
                        testID="habits-reorder-toggle"
                        style={styles.overflowItem}
                      >
                        <Text style={[styles.overflowItemText, { color: colors.textPrimary }]}>
                          Reorder
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )}
            </View>
          </>
        )}
      </View>

      {orderError && (
        <View style={styles.orderBanner} testID="habits-order-error">
          <InlineError message={orderError} />
        </View>
      )}

      {reorderMode ? (
        <FlatList
          data={reorderHabits}
          keyExtractor={reorderKeyExtractor}
          renderItem={renderReorderHabit}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          testID="habits-reorder-list"
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderHabit}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={listFooter}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refresh}
              tintColor={colors.brandPrimary}
            />
          }
          testID="today-habits-list"
        />
      )}

      {undo && !reorderMode && (
        <View style={[styles.undoChip, { backgroundColor: colors.textPrimary }]} testID="undo-chip">
          <Text style={styles.undoMessage}>{undo.message} — </Text>
          <Pressable
            onPress={undoLast}
            accessibilityRole="button"
            accessibilityLabel="Undo"
            testID="undo-chip-action"
          >
            <Text style={[styles.undoAction, { color: colors.brandPrimary }]}>Undo</Text>
          </Pressable>
          <Pressable
            onPress={dismissUndo}
            accessibilityRole="button"
            accessibilityLabel="Dismiss undo"
            hitSlop={8}
            style={styles.undoDismiss}
            testID="undo-chip-dismiss"
          >
            <Text style={styles.undoDismissText}>{"\u00D7"}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// --- Date Header ---

type DateHeaderProps = {
  onNotifications?: () => void;
  unreadCount?: number;
};

function DateHeader({ onNotifications, unreadCount }: DateHeaderProps) {
  const colors = lightTheme;
  const today = new Date();
  const dayName = today.toLocaleDateString(undefined, { weekday: "long" });
  const dateStr = today.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });

  return (
    <View style={styles.dateHeader}>
      <View style={styles.dateHeaderText}>
        <Text style={[styles.dayName, { color: colors.textPrimary }]}>{dayName}</Text>
        <Text style={[styles.dateStr, { color: colors.textSecondary }]}>{dateStr}</Text>
      </View>
      {onNotifications && (
        <Pressable
          onPress={onNotifications}
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount && unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
          style={styles.bellButton}
          testID="notifications-bell"
        >
          <Text style={[styles.bellIcon, { color: colors.textPrimary }]}>{"\uD83D\uDD14"}</Text>
          {unreadCount != null && unreadCount > 0 && (
            <View style={styles.badgeOverlay}>
              <UnreadBadge count={unreadCount} />
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

// --- Not today group ---

type NotTodaySectionProps = {
  habits: Habit[];
  onPress?: (habitId: string) => void;
};

function NotTodaySection({ habits, onPress }: NotTodaySectionProps) {
  const colors = lightTheme;
  const [expanded, setExpanded] = useState(false);

  if (habits.length === 0) {
    return null;
  }

  return (
    <View style={styles.notTodaySection} testID="not-today-section">
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={styles.notTodayHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Not today, ${habits.length} habits`}
        testID="not-today-header"
      >
        <Text style={[styles.notTodayTitle, { color: colors.textTertiary }]}>
          Not today ({habits.length})
        </Text>
        <Text style={[styles.notTodayChevron, { color: colors.textTertiary }]}>
          {expanded ? "\u25B2" : "\u25BC"}
        </Text>
      </Pressable>
      {expanded &&
        habits.map((habit) => (
          <Pressable
            key={habit.id}
            style={[styles.notTodayRow, { borderColor: colors.border }]}
            onPress={() => onPress?.(habit.id)}
            accessibilityRole="button"
            accessibilityLabel={habit.name}
            testID={`not-today-habit-${habit.id}`}
          >
            <View style={[styles.notTodayIcon, { backgroundColor: habit.color ?? colors.brandMuted }]}>
              <Text style={styles.notTodayIconText}>{habit.icon ?? "\u2B50"}</Text>
            </View>
            <Text
              style={[styles.notTodayName, { color: colors.textTertiary }]}
              numberOfLines={1}
            >
              {habit.name}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}

// --- Reorder row ---

type ReorderHabitRowProps = {
  habit: Habit;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

function ReorderHabitRow({ habit, index, total, onMoveUp, onMoveDown }: ReorderHabitRowProps) {
  const colors = lightTheme;
  return (
    <View
      style={[styles.reorderRow, { borderBottomColor: colors.border }]}
      testID={`habits-reorder-row-${habit.id}`}
    >
      <View style={styles.reorderControls}>
        <Pressable
          onPress={onMoveUp}
          disabled={index === 0}
          accessibilityRole="button"
          accessibilityLabel={`Move ${habit.name} up`}
          testID={`habits-move-up-${habit.id}`}
          style={styles.chevronBtn}
        >
          <Text style={{ color: index === 0 ? colors.textTertiary : colors.textPrimary }}>
            {"\u25B2"}
          </Text>
        </Pressable>
        <Pressable
          onPress={onMoveDown}
          disabled={index === total - 1}
          accessibilityRole="button"
          accessibilityLabel={`Move ${habit.name} down`}
          testID={`habits-move-down-${habit.id}`}
          style={styles.chevronBtn}
        >
          <Text
            style={{
              color: index === total - 1 ? colors.textTertiary : colors.textPrimary,
            }}
          >
            {"\u25BC"}
          </Text>
        </Pressable>
      </View>
      <View style={[styles.habitIcon, { backgroundColor: habit.color ?? colors.brandMuted }]}>
        <Text style={styles.habitIconText}>{habit.icon ?? "\u2B50"}</Text>
      </View>
      <Text style={[styles.habitName, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>
        {habit.name}
      </Text>
    </View>
  );
}

// --- Habit Row ---

/** Warm amber for minimum completions — lighter than full-completion green */
const MINIMUM_COLOR = "#F59E0B";

type HabitRowProps = {
  item: TodayHabit;
  today: string;
  completing: Set<string>;
  onToggle: (habitId: string, kind?: CompletionKind) => void;
  onToggleDay: (habitId: string, date: string) => void;
  onPress?: (habitId: string) => void;
};

function HabitRow({ item, today, completing, onToggle, onToggleDay, onPress }: HabitRowProps) {
  const colors = lightTheme;
  const { habit, completedToday, completedTodayKind, flameLevel, consistency, weekDays } = item;
  const hasMinimum = !!habit.minimumDescription;
  const isMinimumCompletion = completedTodayKind === "minimum";
  const todayBusy = completing.has(`${habit.id}:${today}`);

  // Choose checkbox color based on completion kind
  const checkboxColor = completedToday
    ? isMinimumCompletion ? MINIMUM_COLOR : colors.success
    : "transparent";
  const checkboxBorder = completedToday
    ? isMinimumCompletion ? MINIMUM_COLOR : colors.success
    : colors.border;

  return (
    <Card style={styles.habitCard}>
      <Pressable
        style={styles.habitRow}
        onPress={() => onPress?.(habit.id)}
        accessibilityRole="button"
        accessibilityLabel={`${habit.name}, ${completedToday ? (isMinimumCompletion ? "minimum completed" : "completed") : "not completed"}`}
        testID={`today-habit-${habit.id}`}
      >
        {/* Completion toggle — simple checkbox for habits without minimum */}
        {!hasMinimum && (
          <Pressable
            onPress={() => onToggle(habit.id)}
            disabled={todayBusy}
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
                  backgroundColor: checkboxColor,
                  borderColor: checkboxBorder,
                },
                todayBusy && styles.checkboxDisabled,
              ]}
            >
              {completedToday && (
                <Text style={styles.checkmark}>{"\u2713"}</Text>
              )}
            </View>
          </Pressable>
        )}

        {/* Dual completion buttons for habits with minimum configured */}
        {hasMinimum && !completedToday && (
          <View style={styles.dualButtons} testID={`dual-buttons-${habit.id}`}>
            <Pressable
              onPress={() => onToggle(habit.id, "full")}
              disabled={todayBusy}
              style={[styles.dualButton, { backgroundColor: colors.success, opacity: todayBusy ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={`Mark ${habit.name} as fully done`}
              testID={`toggle-full-${habit.id}`}
            >
              <Text style={styles.dualButtonText}>{"\u2713"}</Text>
            </Pressable>
            <Pressable
              onPress={() => onToggle(habit.id, "minimum")}
              disabled={todayBusy}
              style={[styles.dualButton, { backgroundColor: MINIMUM_COLOR, opacity: todayBusy ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={`Log minimum: ${habit.minimumDescription}`}
              testID={`toggle-minimum-${habit.id}`}
            >
              <Text style={styles.dualButtonText}>{"~"}</Text>
            </Pressable>
          </View>
        )}

        {/* Completed state for habits with minimum — shows checkbox with undo */}
        {hasMinimum && completedToday && (
          <Pressable
            onPress={() => onToggle(habit.id)}
            disabled={todayBusy}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: true }}
            accessibilityLabel={`Undo ${isMinimumCompletion ? "minimum" : "full"} completion for ${habit.name}`}
            testID={`toggle-${habit.id}`}
          >
            <View
              style={[
                styles.checkbox,
                {
                  backgroundColor: checkboxColor,
                  borderColor: checkboxBorder,
                },
                todayBusy && styles.checkboxDisabled,
              ]}
            >
              <Text style={styles.checkmark}>{isMinimumCompletion ? "~" : "\u2713"}</Text>
            </View>
          </Pressable>
        )}

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
          {completedToday && isMinimumCompletion && (
            <Text
              style={[styles.minimumLabel, { color: MINIMUM_COLOR }]}
              testID={`minimum-label-${habit.id}`}
            >
              Kept the ember alive
            </Text>
          )}
        </View>

        {/* Flame indicator */}
        <Flame flameLevel={flameLevel as FlameLevel} size="sm" consistency={consistency} />
      </Pressable>

      <WeekStrip
        habit={habit}
        weekDays={weekDays}
        today={today}
        completing={completing}
        onToggleDay={onToggleDay}
      />
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
  todosEmptyPad: {
    paddingHorizontal: spacing.xl,
  },
  dateHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing.sm,
  },
  dateHeaderText: {
    flex: 1,
  },
  bellButton: {
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  bellIcon: {
    fontSize: 24,
  },
  badgeOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
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
  progressTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.base,
    alignItems: "center",
  },
  headerAction: {
    ...typography.bodySmall,
    fontWeight: "600",
  },
  overflowWrap: {
    position: "relative",
  },
  overflowBtn: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  overflowGlyph: {
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 20,
  },
  overflowMenu: {
    position: "absolute",
    top: 28,
    right: 0,
    minWidth: 120,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    ...shadows.sm,
    zIndex: 20,
    elevation: 6,
  },
  overflowItem: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  overflowItemText: {
    ...typography.bodySmall,
    fontWeight: "600",
  },
  orderBanner: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  reorderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  reorderControls: {
    gap: 2,
  },
  chevronBtn: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.base,
    gap: spacing.sm,
  },
  notTodaySection: {
    marginTop: spacing.base,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  notTodayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  notTodayTitle: {
    ...typography.bodySmall,
    fontWeight: "600",
  },
  notTodayChevron: {
    fontSize: 10,
  },
  notTodayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.7,
  },
  notTodayIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  notTodayIconText: {
    fontSize: 16,
  },
  notTodayName: {
    ...typography.bodySmall,
    flex: 1,
    fontWeight: "500",
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
  minimumLabel: {
    ...typography.caption,
    fontStyle: "italic",
    marginTop: 2,
  },
  dualButtons: {
    flexDirection: "column",
    gap: 4,
  },
  dualButton: {
    width: 28,
    height: 22,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  dualButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  fab: {
    position: "absolute",
    bottom: spacing.xl,
    right: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    elevation: 4,
  },
  fabText: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "600",
    lineHeight: 30,
  },
  undoChip: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: radii.md,
    zIndex: 20,
    elevation: 6,
  },
  undoMessage: {
    color: "#FFFFFF",
    ...typography.bodySmall,
    flexShrink: 1,
  },
  undoAction: {
    ...typography.bodySmall,
    fontWeight: "700",
  },
  undoDismiss: {
    marginLeft: "auto",
    paddingLeft: spacing.sm,
  },
  undoDismissText: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 20,
    opacity: 0.7,
  },
});
