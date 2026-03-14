import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import {
  Card,
  Flame,
  Badge,
  LoadingState,
  ErrorState,
} from "../design-system";
import {
  spacing,
  radii,
  typography,
  lightTheme,
  brand,
} from "../design-system";
import { useHabitDetail } from "../hooks/useHabitDetail";
import type { FlameLevel } from "../api/habits";

type Props = {
  habitId: string;
  onBack?: () => void;
};

// --- Date helpers ---

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getDaysOfData(completedDates: string[], today: string): number {
  if (completedDates.length === 0) return 0;
  const earliest = completedDates.length > 0 ? completedDates[0] : today;
  const start = new Date(earliest);
  const end = new Date(today);
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

// --- Insight computations ---

function getMostConsistentDay(completedDates: string[]): string | null {
  if (completedDates.length < 7) return null;
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of completedDates) {
    const day = new Date(d + "T12:00:00").getDay();
    counts[day]++;
  }
  let maxIdx = 0;
  for (let i = 1; i < 7; i++) {
    if (counts[i] > counts[maxIdx]) maxIdx = i;
  }
  return DAY_NAMES[maxIdx];
}

function getMonthlyCompletion(completedDates: string[], today: string): { current: number; previous: number } | null {
  if (completedDates.length === 0) return null;
  const todayDate = new Date(today + "T12:00:00");
  const currentMonth = todayDate.getMonth();
  const currentYear = todayDate.getFullYear();
  const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;

  let current = 0;
  let previous = 0;
  for (const d of completedDates) {
    const date = new Date(d + "T12:00:00");
    if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) current++;
    if (date.getMonth() === prevMonth && date.getFullYear() === prevYear) previous++;
  }
  return { current, previous };
}

function getBestMonth(completedDates: string[]): string | null {
  if (completedDates.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const d of completedDates) {
    const date = new Date(d + "T12:00:00");
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  let bestKey = "";
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  if (!bestKey) return null;
  const [year, month] = bestKey.split("-").map(Number);
  return `${MONTH_NAMES_SHORT[month]} ${year}`;
}

// --- Heatmap helpers ---

type HeatmapDay = {
  date: string;
  count: number;
  month: number;
};

function buildHeatmapData(completedDates: string[], today: string): HeatmapDay[] {
  const completedSet = new Set(completedDates);
  const end = new Date(today + "T12:00:00");
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() + 1);

  const days: HeatmapDay[] = [];
  const current = new Date(start);
  while (current <= end) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, "0");
    const d = String(current.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;
    days.push({
      date: dateStr,
      count: completedSet.has(dateStr) ? 1 : 0,
      month: current.getMonth(),
    });
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function getHeatmapColor(count: number, colors: typeof lightTheme): string {
  if (count === 0) return colors.backgroundSecondary;
  return brand.flame500;
}

// --- Encouraging insight messages ---

function getConsistencyMessage(consistency: number): string {
  if (consistency >= 90) return "Absolutely blazing! You're building something incredible.";
  if (consistency >= 80) return "You're on fire! Keep it up!";
  if (consistency >= 55) return "Strong momentum. You're doing great!";
  if (consistency >= 30) return "Building a solid foundation. Nice work!";
  if (consistency >= 10) return "Every day counts. You're getting started!";
  if (consistency > 0) return "The first steps are the hardest. Keep going!";
  return "Ready to build your habit? One day at a time.";
}

function getMonthComparisonMessage(monthly: { current: number; previous: number }): string | null {
  if (monthly.previous === 0 && monthly.current === 0) return null;
  if (monthly.previous === 0) return `You've already logged ${monthly.current} time${monthly.current === 1 ? "" : "s"} this month. Great start!`;
  if (monthly.current > monthly.previous) return "You're doing better this month than last month!";
  if (monthly.current === monthly.previous) return "You're matching last month's pace. Keep it steady!";
  return "Still time to build momentum this month!";
}

// --- Main component ---

export function StatsScreen({ habitId, onBack }: Props) {
  const colors = lightTheme;
  const { habit, stats, loading, error, refresh } = useHabitDetail(habitId);

  if (loading && !stats) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="stats-loading">
        <LoadingState message="Loading stats..." />
      </View>
    );
  }

  if (error && !stats) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="stats-error">
        <ErrorState message={error.message} onRetry={refresh} />
      </View>
    );
  }

  if (!stats || !habit) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ErrorState message="Stats not available." />
      </View>
    );
  }

  const habitName = habit.name;
  const habitIcon = habit.icon;
  const habitFrequency = habit.frequency;

  const consistency = stats.consistency;
  const flameLevel = stats.flameLevel as FlameLevel;
  const daysOfData = getDaysOfData(stats.completedDates, stats.today);
  const isNewHabit = daysOfData < 7;

  // Compute insights
  const bestDay = getMostConsistentDay(stats.completedDates);
  const monthly = getMonthlyCompletion(stats.completedDates, stats.today);
  const bestMonth = getBestMonth(stats.completedDates);
  const monthMessage = monthly ? getMonthComparisonMessage(monthly) : null;

  // Heatmap
  const heatmapData = buildHeatmapData(stats.completedDates, stats.today);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.scrollContent}
      testID="stats-screen"
    >
      {/* Header with back button */}
      <View style={styles.header}>
        {onBack && (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backButton}
            testID="stats-back-button"
          >
            <Text style={[styles.backText, { color: colors.brandPrimary }]}>{"\u2190"}</Text>
          </Pressable>
        )}
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Statistics</Text>
      </View>

      {/* Habit info */}
      <View style={styles.headerRow}>
        {habitIcon && <Text style={styles.habitIcon}>{habitIcon}</Text>}
        <View style={styles.headerText}>
          <Text style={[styles.habitName, { color: colors.textPrimary }]}>{habitName}</Text>
          <Badge
            label={habitFrequency.charAt(0).toUpperCase() + habitFrequency.slice(1)}
            variant="default"
          />
        </View>
        <View style={styles.flameContainer} testID="stats-flame">
          <Flame flameLevel={flameLevel} size="lg" consistency={consistency} />
        </View>
      </View>

      {/* Consistency card */}
      <View testID="consistency-card">
      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Consistency
        </Text>

        {/* Big percentage */}
        <View style={styles.bigStatRow}>
          <Text
            style={[styles.bigPercent, { color: colors.brandPrimary }]}
            testID="stats-consistency-value"
          >
            {Math.round(consistency)}%
          </Text>
          <Text style={[styles.bigStatLabel, { color: colors.textSecondary }]}>
            over the last {stats.windowDays} days
          </Text>
        </View>

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
            />
          </View>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.textPrimary }]} testID="stats-window-completions">
              {stats.completionsInWindow}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              Last {stats.windowDays} days
            </Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.textPrimary }]} testID="stats-total-completions">
              {stats.totalCompletions}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              All time
            </Text>
          </View>
        </View>

        {/* Consistency message */}
        <Text
          style={[styles.encouragement, { color: colors.textSecondary }]}
          testID="stats-consistency-message"
        >
          {getConsistencyMessage(consistency)}
        </Text>
      </Card>
      </View>

      {/* Calendar heatmap */}
      <View testID="heatmap-card">
      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Year Overview
        </Text>
        <View style={styles.heatmapContainer} testID="calendar-heatmap">
          {/* Month labels */}
          <View style={styles.heatmapMonthLabels}>
            {MONTH_NAMES_SHORT.map((m) => (
              <Text key={m} style={[styles.heatmapMonthLabel, { color: colors.textTertiary }]}>
                {m}
              </Text>
            ))}
          </View>
          {/* Grid */}
          <View style={styles.heatmapGrid}>
            {heatmapData.map((day) => (
              <View
                key={day.date}
                style={[
                  styles.heatmapCell,
                  { backgroundColor: getHeatmapColor(day.count, colors) },
                ]}
                accessibilityLabel={`${day.date}${day.count > 0 ? ", completed" : ""}`}
                testID={`heatmap-day-${day.date}`}
              />
            ))}
          </View>
          {/* Legend */}
          <View style={styles.heatmapLegend}>
            <Text style={[styles.heatmapLegendText, { color: colors.textTertiary }]}>Less</Text>
            <View style={[styles.heatmapLegendCell, { backgroundColor: colors.backgroundSecondary }]} />
            <View style={[styles.heatmapLegendCell, { backgroundColor: brand.flame500 }]} />
            <Text style={[styles.heatmapLegendText, { color: colors.textTertiary }]}>More</Text>
          </View>
        </View>
      </Card>
      </View>

      {/* Insights */}
      <View testID="insights-card">
      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Insights
        </Text>

        {isNewHabit ? (
          <View testID="new-habit-message">
            <Text style={[styles.insightText, { color: colors.textSecondary }]}>
              Just getting started! Check back after a week for trends and patterns.
            </Text>
          </View>
        ) : (
          <View testID="insights-list">
            {/* Best day */}
            {bestDay && (
              <View style={styles.insightRow} testID="insight-best-day">
                <Text style={styles.insightIcon}>📊</Text>
                <Text style={[styles.insightText, { color: colors.textSecondary }]}>
                  Your most consistent day is {bestDay}
                </Text>
              </View>
            )}

            {/* Month comparison */}
            {monthMessage && (
              <View style={styles.insightRow} testID="insight-month-comparison">
                <Text style={styles.insightIcon}>📈</Text>
                <Text style={[styles.insightText, { color: colors.textSecondary }]}>
                  {monthMessage}
                </Text>
              </View>
            )}

            {/* Best month */}
            {bestMonth && (
              <View style={styles.insightRow} testID="insight-best-month">
                <Text style={styles.insightIcon}>🏆</Text>
                <Text style={[styles.insightText, { color: colors.textSecondary }]}>
                  Your best month was {bestMonth}
                </Text>
              </View>
            )}

            {/* Total completions */}
            <View style={styles.insightRow} testID="insight-total">
              <Text style={styles.insightIcon}>✅</Text>
              <Text style={[styles.insightText, { color: colors.textSecondary }]}>
                {stats.totalCompletions} total completion{stats.totalCompletions === 1 ? "" : "s"} all time
              </Text>
            </View>
          </View>
        )}
      </Card>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.base,
    gap: spacing.sm,
  },
  backButton: {
    padding: spacing.xs,
  },
  backText: {
    fontSize: 24,
  },
  headerTitle: {
    ...typography.h2,
    flex: 1,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.base,
    paddingHorizontal: spacing.xs,
  },
  habitIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  habitName: {
    ...typography.h3,
  },
  flameContainer: {
    marginLeft: spacing.base,
    alignItems: "center",
  },

  // Cards
  card: {
    marginBottom: spacing.base,
  },
  sectionTitle: {
    ...typography.h4,
    marginBottom: spacing.md,
  },

  // Consistency
  bigStatRow: {
    alignItems: "center",
    marginBottom: spacing.base,
  },
  bigPercent: {
    ...typography.h1,
  },
  bigStatLabel: {
    ...typography.bodySmall,
    marginTop: spacing.xs,
  },
  progressContainer: {
    marginBottom: spacing.base,
  },
  progressTrack: {
    height: 8,
    borderRadius: radii.full,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radii.full,
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

  // Heatmap
  heatmapContainer: {
    alignItems: "center",
  },
  heatmapMonthLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: spacing.xs,
  },
  heatmapMonthLabel: {
    ...typography.caption,
    textAlign: "center",
    flex: 1,
  },
  heatmapGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
    justifyContent: "flex-start",
  },
  heatmapCell: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  heatmapLegend: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
    alignSelf: "flex-end",
  },
  heatmapLegendText: {
    ...typography.caption,
  },
  heatmapLegendCell: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },

  // Insights
  insightRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  insightIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  insightText: {
    ...typography.body,
    flex: 1,
  },
});
