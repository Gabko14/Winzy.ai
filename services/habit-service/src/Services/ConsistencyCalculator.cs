using Winzy.HabitService.Entities;

namespace Winzy.HabitService.Services;

/// <summary>
/// Calculates habit consistency using a 60-day rolling window.
/// Consistency replaces streaks — missing a day doesn't reset to zero.
/// Returns a percentage 0-100.
/// </summary>
public static class ConsistencyCalculator
{
    public const int WindowDays = 60;

    /// <summary>
    /// Calculates the consistency percentage for a habit over a 60-day rolling window.
    /// All date calculations use the user's supplied IANA timezone.
    /// </summary>
    /// <param name="habit">The habit with its frequency configuration.</param>
    /// <param name="completedLocalDates">Set of local dates where the habit was completed.</param>
    /// <param name="userTimeZone">The user's IANA timezone for resolving "today".</param>
    /// <returns>Consistency percentage from 0 to 100.</returns>
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
    /// </summary>
    public static double Calculate(
        Habit habit,
        HashSet<DateOnly> completedLocalDates,
        DateOnly today,
        DateOnly? habitCreatedLocalDate = null)
    {
        var habitCreatedDate = habitCreatedLocalDate ?? DateOnly.FromDateTime(habit.CreatedAt.UtcDateTime);
        var windowStart = today.AddDays(-(WindowDays - 1));

        // If the habit was created after the window start, narrow the window
        var effectiveStart = windowStart > habitCreatedDate ? windowStart : habitCreatedDate;

        // If the habit was created today or in the future, no applicable days yet
        if (effectiveStart > today)
            return 0;

        // Weekly frequency uses a different algorithm: weeks with completions / total weeks
        if (habit.Frequency == FrequencyType.Weekly)
            return CalculateWeekly(effectiveStart, today, completedLocalDates);

        var applicableDays = 0;
        var completedDays = 0;

        for (var date = effectiveStart; date <= today; date = date.AddDays(1))
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
    /// Weekly consistency: number of weeks with at least one completion / total weeks in window.
    /// A "week" is Monday–Sunday (ISO week). Partial weeks at window boundaries still count.
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
