import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import {
  Flame,
  Card,
  LoadingState,
  ErrorState,
  Button,
  Badge,
} from "../design-system";
import {
  spacing,
  radii,
  typography,
  lightTheme,
  shadows,
} from "../design-system";
import { useHabitDetail, useToggleCompletion } from "../hooks/useHabitDetail";
import { isApiError } from "../api";
import type { FlameLevel } from "../api/habits";

type Props = {
  habitId: string;
  onBack?: () => void;
  onEdit?: (habitId: string) => void;
  onArchive?: (habitId: string) => void;
};

// --- Calendar helpers ---

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Monday-based offset (0=Mon, 6=Sun) for the 1st of the month */
function getFirstDayOffset(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay();
  return (day + 6) % 7;
}

function formatDate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function parseDate(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}

function todayString(): string {
  const now = new Date();
  return formatDate(now.getFullYear(), now.getMonth(), now.getDate());
}

// --- Encouraging messages ---

function getEncouragingMessage(consistency: number): string {
  if (consistency >= 80) return "You're on fire! Keep it up!";
  if (consistency >= 55) return "Strong momentum. You're doing great!";
  if (consistency >= 30) return "Building a solid foundation. Nice work!";
  if (consistency >= 10) return "Every day counts. You're getting started!";
  return "Ready to build your habit? One day at a time.";
}

function getConsistencyLabel(consistency: number): string {
  if (consistency >= 80) return "Blazing";
  if (consistency >= 55) return "Strong";
  if (consistency >= 30) return "Steady";
  if (consistency >= 10) return "Growing";
  return "Starting";
}

function getConsistencyVariant(consistency: number): "success" | "info" | "warning" | "default" {
  if (consistency >= 55) return "success";
  if (consistency >= 30) return "info";
  if (consistency >= 10) return "warning";
  return "default";
}

// --- Calendar component ---

type CalendarProps = {
  year: number;
  month: number;
  completedDates: Set<string>;
  windowStart: string;
  today: string;
  mutating: boolean;
  onToggleDate: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
};

function Calendar({
  year,
  month,
  completedDates,
  windowStart,
  today,
  mutating,
  onToggleDate,
  onPrevMonth,
  onNextMonth,
}: CalendarProps) {
  const colors = lightTheme;
  const daysInMonth = getDaysInMonth(year, month);
  const firstOffset = getFirstDayOffset(year, month);
  const todayParsed = parseDate(today);
  const windowStartParsed = parseDate(windowStart);

  const canGoNext = !(year === todayParsed.year && month === todayParsed.month);

  const cells: React.ReactNode[] = [];

  // Empty cells before the 1st
  for (let i = 0; i < firstOffset; i++) {
    cells.push(<View key={`empty-${i}`} style={styles.calendarCell} />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = formatDate(year, month, day);
    const isCompleted = completedDates.has(dateStr);
    const isToday = dateStr === today;

    // Can only toggle dates within the 60-day window and not in the future
    const isInWindow = dateStr >= windowStart && dateStr <= today;

    // Is before habit window (too old to correct)
    const isFuture = dateStr > today;
    const isPast = dateStr < windowStart;

    cells.push(
      <Pressable
        key={dateStr}
        style={[
          styles.calendarCell,
          isCompleted && { backgroundColor: colors.brandPrimary },
          isToday && !isCompleted && styles.calendarToday,
          (isFuture || isPast) && styles.calendarDisabled,
        ]}
        onPress={() => {
          if (isInWindow && !mutating) {
            onToggleDate(dateStr);
          }
        }}
        disabled={!isInWindow || mutating}
        accessibilityRole="button"
        accessibilityLabel={`${MONTH_NAMES[month]} ${day}${isCompleted ? ", completed" : ""}${isToday ? ", today" : ""}`}
        accessibilityState={{ disabled: !isInWindow || mutating }}
        testID={`calendar-day-${dateStr}`}
      >
        <Text
          style={[
            styles.calendarDayText,
            { color: isCompleted ? colors.textInverse : colors.textPrimary },
            (isFuture || isPast) && { color: colors.textTertiary },
          ]}
        >
          {day}
        </Text>
      </Pressable>,
    );
  }

  return (
    <View testID="completion-calendar">
      <View style={styles.calendarNav}>
        <Pressable onPress={onPrevMonth} accessibilityLabel="Previous month" testID="calendar-prev">
          <Text style={[styles.calendarNavArrow, { color: colors.brandPrimary }]}>{"<"}</Text>
        </Pressable>
        <Text style={[styles.calendarMonthLabel, { color: colors.textPrimary }]}>
          {MONTH_NAMES[month]} {year}
        </Text>
        <Pressable
          onPress={onNextMonth}
          disabled={!canGoNext}
          accessibilityLabel="Next month"
          testID="calendar-next"
        >
          <Text
            style={[
              styles.calendarNavArrow,
              { color: canGoNext ? colors.brandPrimary : colors.textTertiary },
            ]}
          >
            {">"}
          </Text>
        </Pressable>
      </View>
      <View style={styles.calendarHeader}>
        {DAY_LABELS.map((label) => (
          <View key={label} style={styles.calendarCell}>
            <Text style={[styles.calendarHeaderText, { color: colors.textSecondary }]}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.calendarGrid}>{cells}</View>
    </View>
  );
}

// --- Main screen ---

export function HabitDetailScreen({ habitId, onBack, onEdit, onArchive }: Props) {
  const colors = lightTheme;
  const { habit, stats, loading, error, refresh, timezone } = useHabitDetail(habitId);

  // Track completed dates locally for optimistic calendar updates
  const [completedDates, setCompletedDates] = useState<Set<string>>(new Set());
  const [datesLoaded, setDatesLoaded] = useState(false);

  // Calendar month state — default to current month
  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear] = useState(now.getFullYear());

  // Build completed dates set from stats window when stats load
  // We derive from completionsInWindow + windowStart + today for the calendar
  // The real completion dates come from the stats refresh cycle
  const { complete, uncomplete, loading: mutating } = useToggleCompletion(
    habitId,
    timezone,
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Mark dates as loaded once stats arrive so we know the calendar is ready
  useEffect(() => {
    if (stats && !datesLoaded) {
      setDatesLoaded(true);
    }
  }, [stats, datesLoaded]);

  const handleToggleDate = useCallback(
    async (date: string) => {
      const wasCompleted = completedDates.has(date);

      // Optimistic update
      setCompletedDates((prev) => {
        const next = new Set(prev);
        if (wasCompleted) {
          next.delete(date);
        } else {
          next.add(date);
        }
        return next;
      });

      try {
        if (wasCompleted) {
          await uncomplete(date);
        } else {
          await complete(date);
        }
      } catch (err) {
        // Revert optimistic update
        setCompletedDates((prev) => {
          const next = new Set(prev);
          if (wasCompleted) {
            next.add(date);
          } else {
            next.delete(date);
          }
          return next;
        });

        const message = isApiError(err) ? err.message : "Something went wrong. Please try again.";
        if (Platform.OS === "web") {
          // Alert.alert not supported on web
          // The error is surfaced through the mutation state
        } else {
          Alert.alert("Oops", message);
        }
      }
    },
    [completedDates, complete, uncomplete],
  );

  const handlePrevMonth = useCallback(() => {
    setCalMonth((m) => {
      if (m === 0) {
        setCalYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const handleNextMonth = useCallback(() => {
    setCalMonth((m) => {
      const today = new Date();
      if (m === 11) {
        setCalYear((y) => {
          if (y + 1 > today.getFullYear()) return y;
          return y + 1;
        });
        return 0;
      }
      return m + 1;
    });
  }, []);

  // --- Loading state ---
  if (loading && !habit) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="habit-detail-loading">
        <LoadingState message="Loading habit details..." />
      </View>
    );
  }

  // --- Error state ---
  if (error && !habit) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="habit-detail-error">
        <ErrorState message={error.message} onRetry={refresh} />
      </View>
    );
  }

  if (!habit || !stats) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ErrorState message="Habit not found." />
      </View>
    );
  }

  const consistency = stats.consistency;
  const flameLevel = stats.flameLevel as FlameLevel;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.scrollContent}
      testID="habit-detail-screen"
    >
      {/* Back button */}
      {onBack && (
        <Pressable onPress={onBack} style={styles.backButton} accessibilityLabel="Go back" testID="back-button">
          <Text style={[styles.backText, { color: colors.brandPrimary }]}>{"< Back"}</Text>
        </Pressable>
      )}

      {/* Header card with flame */}
      <Card elevated style={styles.headerCard}>
        <View style={styles.headerRow}>
          <View style={styles.headerInfo}>
            {habit.icon && (
              <Text style={styles.habitIcon} testID="habit-icon">
                {habit.icon}
              </Text>
            )}
            <View style={styles.headerText}>
              <Text
                style={[styles.habitName, { color: colors.textPrimary }]}
                testID="habit-name"
              >
                {habit.name}
              </Text>
              <View style={styles.headerMeta}>
                <Badge
                  label={habit.frequency.charAt(0).toUpperCase() + habit.frequency.slice(1)}
                  variant="default"
                />
                <Badge
                  label={getConsistencyLabel(consistency)}
                  variant={getConsistencyVariant(consistency)}
                />
              </View>
            </View>
          </View>
          <View style={styles.flameContainer} testID="habit-flame">
            <Flame
              flameLevel={flameLevel}
              size="lg"
              consistency={consistency}
            />
          </View>
        </View>
      </Card>

      {/* Consistency stats card */}
      <Card style={styles.statsCard}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Consistency
        </Text>

        {/* Progress bar */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressTrack, { backgroundColor: colors.backgroundSecondary }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: colors.brandPrimary,
                  width: `${Math.min(consistency, 100)}%`,
                },
              ]}
              testID="consistency-bar"
            />
          </View>
          <Text
            style={[styles.consistencyPercent, { color: colors.brandPrimary }]}
            testID="consistency-value"
          >
            {Math.round(consistency)}%
          </Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.textPrimary }]} testID="completions-in-window">
              {stats.completionsInWindow}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              Last {stats.windowDays} days
            </Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.textPrimary }]} testID="total-completions">
              {stats.totalCompletions}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              Total
            </Text>
          </View>
        </View>

        {/* Encouraging message */}
        <Text
          style={[styles.encouragement, { color: colors.textSecondary }]}
          testID="encouraging-message"
        >
          {getEncouragingMessage(consistency)}
        </Text>
      </Card>

      {/* Calendar card */}
      <Card style={styles.calendarCard}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Completion History
        </Text>
        <Text style={[styles.calendarHint, { color: colors.textTertiary }]}>
          Tap a date to log or correct a completion
        </Text>
        <Calendar
          year={calYear}
          month={calMonth}
          completedDates={completedDates}
          windowStart={stats.windowStart}
          today={stats.today}
          mutating={mutating}
          onToggleDate={handleToggleDate}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
        />
      </Card>

      {/* Actions */}
      <View style={styles.actions}>
        {onEdit && (
          <Button
            title="Edit habit"
            onPress={() => onEdit(habitId)}
            variant="secondary"
            size="md"
            accessibilityLabel="Edit this habit"
          />
        )}
        {onArchive && (
          <Button
            title="Archive habit"
            onPress={() => {
              if (Platform.OS === "web") {
                onArchive(habitId);
              } else {
                Alert.alert(
                  "Archive habit",
                  "This will hide the habit from your daily view. You can restore it later.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Archive", style: "destructive", onPress: () => onArchive(habitId) },
                  ],
                );
              }
            }}
            variant="ghost"
            size="md"
            accessibilityLabel="Archive this habit"
          />
        )}
      </View>
    </ScrollView>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.base,
    paddingBottom: spacing["4xl"],
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["3xl"],
  },
  backButton: {
    marginBottom: spacing.base,
    alignSelf: "flex-start",
  },
  backText: {
    ...typography.body,
    fontWeight: "600",
  },

  // Header
  headerCard: {
    marginBottom: spacing.base,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  habitIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  habitName: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  headerMeta: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  flameContainer: {
    marginLeft: spacing.base,
    alignItems: "center",
  },

  // Stats
  statsCard: {
    marginBottom: spacing.base,
  },
  sectionTitle: {
    ...typography.h4,
    marginBottom: spacing.md,
  },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.base,
  },
  progressTrack: {
    flex: 1,
    height: 8,
    borderRadius: radii.full,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radii.full,
  },
  consistencyPercent: {
    ...typography.h4,
    minWidth: 48,
    textAlign: "right",
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.base,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    ...typography.h3,
  },
  statLabel: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 32,
  },
  encouragement: {
    ...typography.body,
    textAlign: "center",
    fontStyle: "italic",
  },

  // Calendar
  calendarCard: {
    marginBottom: spacing.base,
  },
  calendarHint: {
    ...typography.caption,
    marginBottom: spacing.md,
  },
  calendarNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  calendarNavArrow: {
    ...typography.h3,
    paddingHorizontal: spacing.md,
  },
  calendarMonthLabel: {
    ...typography.body,
    fontWeight: "600",
  },
  calendarHeader: {
    flexDirection: "row",
    marginBottom: spacing.xs,
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calendarCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },
  calendarHeaderText: {
    ...typography.caption,
    fontWeight: "600",
    textAlign: "center",
  },
  calendarDayText: {
    ...typography.bodySmall,
    fontWeight: "500",
  },
  calendarToday: {
    borderWidth: 2,
    borderColor: lightTheme.brandPrimary,
  },
  calendarDisabled: {
    opacity: 0.3,
  },

  // Actions
  actions: {
    gap: spacing.md,
  },
});
