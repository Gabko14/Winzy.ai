using Winzy.Contracts;
using Winzy.HabitService.Entities;

namespace Winzy.HabitService.Services;

/// <summary>
/// Calculates habit consistency using a 60-day rolling window.
/// Consistency replaces streaks — missing a day doesn't reset to zero.
/// Returns a percentage 0-100.
///
/// Honest Minimums weighting (v1):
///   Full completion = 1.0 weight
///   Minimum completion = 0.5 weight
/// </summary>
public static class ConsistencyCalculator
{
    public const int WindowDays = 60;
    public const double FullWeight = 1.0;
    public const double MinimumWeight = 0.5;

    /// <summary>
    /// Calculates the consistency percentage for a habit over a 60-day rolling window.
    /// All date calculations use the user's supplied IANA timezone.
    /// Treats all completions as full (backwards-compatible).
    /// </summary>
    public static double Calculate(
        Habit habit,
        HashSet<DateOnly> completedLocalDates,
        TimeZoneInfo userTimeZone)
    {
        var userNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, userTimeZone);
        var today = DateOnly.FromDateTime(userNow);

        // Convert habit creation to user's local timezone (not UTC)
        var habitCreatedLocal = TimeZoneInfo.ConvertTimeFromUtc(habit.CreatedAt.UtcDateTime, userTimeZone);
        var habitCreatedDate = DateOnly.FromDateTime(habitCreatedLocal);

        return Calculate(habit, completedLocalDates, today, habitCreatedDate);
    }

    /// <summary>
    /// Calculates the consistency percentage for a habit over a 60-day rolling window.
    /// Uses explicit "today" and "habitCreatedDate" for testability.
    /// Treats all completions as full (backwards-compatible).
    /// </summary>
    public static double Calculate(
        Habit habit,
        HashSet<DateOnly> completedLocalDates,
        DateOnly today,
        DateOnly? habitCreatedLocalDate = null)
    {
        // Convert HashSet to Dictionary with all Full completions for the weighted overload
        var weighted = new Dictionary<DateOnly, CompletionKind>(completedLocalDates.Count);
        foreach (var date in completedLocalDates)
            weighted[date] = CompletionKind.Full;

        return Calculate(habit, weighted, today, habitCreatedLocalDate);
    }

    /// <summary>
    /// Calculates the weighted consistency percentage for a habit over a 60-day rolling window.
    /// All date calculations use the user's supplied IANA timezone.
    /// Full = 1.0 weight, Minimum = 0.5 weight.
    /// </summary>
    public static double Calculate(
        Habit habit,
        Dictionary<DateOnly, CompletionKind> completions,
        TimeZoneInfo userTimeZone)
    {
        var userNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, userTimeZone);
        var today = DateOnly.FromDateTime(userNow);

        var habitCreatedLocal = TimeZoneInfo.ConvertTimeFromUtc(habit.CreatedAt.UtcDateTime, userTimeZone);
        var habitCreatedDate = DateOnly.FromDateTime(habitCreatedLocal);

        return Calculate(habit, completions, today, habitCreatedDate);
    }

    /// <summary>
    /// Calculates the weighted consistency percentage for a habit over a 60-day rolling window.
    /// Uses explicit "today" and "habitCreatedDate" for testability.
    /// Full = 1.0 weight, Minimum = 0.5 weight.
    /// </summary>
    public static double Calculate(
        Habit habit,
        Dictionary<DateOnly, CompletionKind> completions,
        DateOnly today,
        DateOnly? habitCreatedLocalDate = null)
    {
        var habitCreatedDate = habitCreatedLocalDate ?? DateOnly.FromDateTime(habit.CreatedAt.UtcDateTime);
        var windowStart = today.AddDays(-(WindowDays - 1));

        // If the habit was created after the window start, narrow the window
        var effectiveStart = windowStart > habitCreatedDate ? windowStart : habitCreatedDate;

        // If the habit was created today or in the future, no applicable days yet.
        // A habit created today has zero track record — consistency starts accumulating tomorrow.
        // The frontend shows "completed today" via the completedToday flag independently.
        if (effectiveStart >= today)
            return 0;

        // Weekly frequency uses a different algorithm: weeks with completions / total weeks
        if (habit.Frequency == FrequencyType.Weekly)
            return CalculateWeeklyWeighted(effectiveStart, today, completions);

        var applicableDays = 0;
        var weightedSum = 0.0;

        for (var date = effectiveStart; date <= today; date = date.AddDays(1))
        {
            if (!IsApplicableDay(habit, date))
                continue;

            applicableDays++;
            if (completions.TryGetValue(date, out var kind))
                weightedSum += GetWeight(kind);
        }

        if (applicableDays == 0)
            return 0;

        return Math.Round(weightedSum / applicableDays * 100, 1);
    }

    /// <summary>
    /// Weekly consistency with weighting: for each week, the best completion kind determines the weight.
    /// Full in any day of the week = 1.0, only minimums = 0.5, no completions = 0.
    /// </summary>
    private static double CalculateWeeklyWeighted(
        DateOnly effectiveStart,
        DateOnly today,
        Dictionary<DateOnly, CompletionKind> completions)
    {
        var totalWeeks = 0;
        var weightedSum = 0.0;

        var weekStart = GetIsoWeekStart(effectiveStart);

        while (weekStart <= today)
        {
            var weekEnd = weekStart.AddDays(6);

            var overlapStart = weekStart < effectiveStart ? effectiveStart : weekStart;
            var overlapEnd = weekEnd > today ? today : weekEnd;

            if (overlapStart <= overlapEnd)
            {
                totalWeeks++;

                // Find the best completion kind in this week
                var bestWeight = 0.0;
                for (var d = overlapStart; d <= overlapEnd; d = d.AddDays(1))
                {
                    if (completions.TryGetValue(d, out var kind))
                    {
                        var w = GetWeight(kind);
                        if (w > bestWeight)
                            bestWeight = w;
                        if (bestWeight >= FullWeight)
                            break; // Can't do better than full
                    }
                }

                weightedSum += bestWeight;
            }

            weekStart = weekStart.AddDays(7);
        }

        if (totalWeeks == 0)
            return 0;

        return Math.Round(weightedSum / totalWeeks * 100, 1);
    }

    /// <summary>
    /// Weekly consistency: number of weeks with at least one completion / total weeks in window.
    /// A "week" is Monday-Sunday (ISO week). Partial weeks at window boundaries still count.
    /// Backwards-compatible (unweighted) overload.
    /// </summary>
    private static double CalculateWeekly(
        DateOnly effectiveStart,
        DateOnly today,
        HashSet<DateOnly> completedDates)
    {
        var totalWeeks = 0;
        var completedWeeks = 0;

        // Start from the Monday of the week containing effectiveStart
        var weekStart = GetIsoWeekStart(effectiveStart);

        while (weekStart <= today)
        {
            var weekEnd = weekStart.AddDays(6);

            // Clamp to the effective window
            var overlapStart = weekStart < effectiveStart ? effectiveStart : weekStart;
            var overlapEnd = weekEnd > today ? today : weekEnd;

            if (overlapStart <= overlapEnd)
            {
                totalWeeks++;

                // Check if any completion falls within this week's overlap
                for (var d = overlapStart; d <= overlapEnd; d = d.AddDays(1))
                {
                    if (completedDates.Contains(d))
                    {
                        completedWeeks++;
                        break;
                    }
                }
            }

            weekStart = weekStart.AddDays(7);
        }

        if (totalWeeks == 0)
            return 0;

        return Math.Round((double)completedWeeks / totalWeeks * 100, 1);
    }

    /// <summary>
    /// Returns the Monday (ISO week start) for the week containing the given date.
    /// </summary>
    private static DateOnly GetIsoWeekStart(DateOnly date)
    {
        // Monday=0 .. Sunday=6
        var dayOfWeek = ((int)date.DayOfWeek + 6) % 7;
        return date.AddDays(-dayOfWeek);
    }

    /// <summary>
    /// Maps a consistency percentage to a Flame intensity level (0-4).
    /// The thresholds are asymmetric: "grows quickly, shrinks slowly."
    /// Rising thresholds are lower so improvement is rewarded fast.
    /// Falling thresholds are higher so decline is forgiving.
    /// </summary>
    /// <param name="consistency">Consistency percentage (0-100).</param>
    /// <param name="previousLevel">
    /// The user's previous flame level (null if unknown / first calculation).
    /// When provided, the "shrinks slowly" thresholds apply — the flame won't
    /// drop a level until consistency falls further below the rising threshold.
    /// </param>
    /// <returns>
    /// A <see cref="FlameLevel"/> value: None (0), Ember (1), Steady (2), Strong (3), Blazing (4).
    /// </returns>
    public static FlameLevel GetFlameLevel(double consistency, FlameLevel? previousLevel = null)
    {
        // Rising thresholds — used when consistency is improving or no previous level known.
        // "Grows quickly": lower thresholds so users see flame growth fast.
        //   0-9%   -> None
        //   10-29% -> Ember
        //   30-54% -> Steady
        //   55-79% -> Strong
        //   80%+   -> Blazing
        //
        // Falling thresholds — used when consistency would cause a level drop.
        // "Shrinks slowly": the flame holds its level until consistency drops further.
        //   below 5%  -> None
        //   below 20% -> Ember (was Steady, holds until 20%)
        //   below 40% -> Steady (was Strong, holds until 40%)
        //   below 65% -> Strong (was Blazing, holds until 65%)

        var risingLevel = consistency switch
        {
            >= 80 => FlameLevel.Blazing,
            >= 55 => FlameLevel.Strong,
            >= 30 => FlameLevel.Steady,
            >= 10 => FlameLevel.Ember,
            _ => FlameLevel.None
        };

        if (previousLevel is null || risingLevel >= previousLevel.Value)
            return risingLevel;

        // Apply "shrinks slowly" — use lower falling thresholds to resist decline
        var fallingLevel = consistency switch
        {
            >= 65 => FlameLevel.Blazing,
            >= 40 => FlameLevel.Strong,
            >= 20 => FlameLevel.Steady,
            >= 5 => FlameLevel.Ember,
            _ => FlameLevel.None
        };

        // The flame can't exceed the previous level (it's declining, not rising)
        return fallingLevel > previousLevel.Value ? previousLevel.Value : fallingLevel;
    }

    /// <summary>
    /// Calculates consistency within an arbitrary date range using timezone-aware date handling.
    /// Converts the habit's creation timestamp to the user's local timezone before clamping.
    /// </summary>
    public static double CalculateForDateRange(
        Habit habit,
        HashSet<DateOnly> completedLocalDates,
        DateOnly rangeStart,
        DateOnly rangeEnd,
        TimeZoneInfo userTimeZone)
    {
        var habitCreatedLocal = TimeZoneInfo.ConvertTimeFromUtc(habit.CreatedAt.UtcDateTime, userTimeZone);
        var habitCreatedDate = DateOnly.FromDateTime(habitCreatedLocal);

        return CalculateForDateRange(habit, completedLocalDates, rangeStart, rangeEnd, habitCreatedDate);
    }

    /// <summary>
    /// Calculates consistency within an arbitrary date range (not locked to the 60-day rolling window).
    /// Used by the challenge service for CustomDateRange milestones.
    /// Uses explicit habitCreatedLocalDate for testability; falls back to UTC if not provided.
    /// </summary>
    public static double CalculateForDateRange(
        Habit habit,
        HashSet<DateOnly> completedLocalDates,
        DateOnly rangeStart,
        DateOnly rangeEnd,
        DateOnly? habitCreatedLocalDate = null)
    {
        if (rangeStart > rangeEnd)
            return 0;

        // Clamp range start to the habit's creation date — days before the habit
        // existed are not applicable and would artificially lower consistency.
        var habitCreatedDate = habitCreatedLocalDate ?? DateOnly.FromDateTime(habit.CreatedAt.UtcDateTime);
        var effectiveStart = rangeStart < habitCreatedDate ? habitCreatedDate : rangeStart;

        if (effectiveStart > rangeEnd)
            return 0;

        if (habit.Frequency == FrequencyType.Weekly)
            return CalculateWeekly(effectiveStart, rangeEnd, completedLocalDates);

        var applicableDays = 0;
        var completedDays = 0;

        for (var date = effectiveStart; date <= rangeEnd; date = date.AddDays(1))
        {
            if (!IsApplicableDay(habit, date))
                continue;

            applicableDays++;
            if (completedLocalDates.Contains(date))
                completedDays++;
        }

        if (applicableDays == 0)
            return 0;

        return Math.Round((double)completedDays / applicableDays * 100, 1);
    }

    /// <summary>
    /// Returns the weight for a completion kind.
    /// Full = 1.0, Minimum = 0.5, None = 0.
    /// </summary>
    public static double GetWeight(CompletionKind kind) => kind switch
    {
        CompletionKind.Full => FullWeight,
        CompletionKind.Minimum => MinimumWeight,
        _ => 0
    };

    /// <summary>
    /// Determines whether a given date is an "applicable" day for this habit
    /// based on its frequency type. Used for Daily and Custom frequencies.
    /// </summary>
    private static bool IsApplicableDay(Habit habit, DateOnly date)
    {
        return habit.Frequency switch
        {
            FrequencyType.Daily => true,
            FrequencyType.Custom => habit.CustomDays?.Contains(date.DayOfWeek) ?? false,
            _ => false
        };
    }
}

/// <summary>
/// Flame intensity levels. Higher = more consistent.
/// Frontend maps these to visual flame states.
/// </summary>
public enum FlameLevel
{
    None = 0,
    Ember = 1,
    Steady = 2,
    Strong = 3,
    Blazing = 4
}
