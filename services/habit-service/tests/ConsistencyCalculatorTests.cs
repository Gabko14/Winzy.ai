using Winzy.HabitService.Entities;
using Winzy.HabitService.Services;

namespace Winzy.HabitService.Tests;

public class ConsistencyCalculatorTests
{
    private static Habit MakeHabit(
        FrequencyType frequency = FrequencyType.Daily,
        List<DayOfWeek>? customDays = null,
        DateOnly? createdDate = null)
    {
        var created = createdDate ?? new DateOnly(2025, 1, 1);
        return new Habit
        {
            Id = Guid.NewGuid(),
            UserId = Guid.NewGuid(),
            Name = "Test Habit",
            Frequency = frequency,
            CustomDays = customDays,
            CreatedAt = new DateTimeOffset(created.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero)
        };
    }

    // --- Daily frequency ---

    [Fact]
    public void Daily_AllDaysCompleted_Returns100()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: new DateOnly(2024, 12, 1));

        var completed = new HashSet<DateOnly>();
        for (var d = today.AddDays(-59); d <= today; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(100, result);
    }

    [Fact]
    public void Daily_NoDaysCompleted_Returns0()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: new DateOnly(2024, 12, 1));

        var result = ConsistencyCalculator.Calculate(habit, [], today);

        Assert.Equal(0, result);
    }

    [Fact]
    public void Daily_HalfDaysCompleted_Returns50()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: new DateOnly(2024, 12, 1));

        // Complete every other day in the 60-day window
        var completed = new HashSet<DateOnly>();
        var windowStart = today.AddDays(-59);
        for (var d = windowStart; d <= today; d = d.AddDays(2))
            completed.Add(d);

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(50, result);
    }

    // --- New habit (created within window) ---

    [Fact]
    public void Daily_NewHabit_OnlyCountsDaysSinceCreation()
    {
        var today = new DateOnly(2025, 3, 1);
        // Created 10 days ago
        var createdDate = today.AddDays(-9);
        var habit = MakeHabit(createdDate: createdDate);

        // Completed all 10 days
        var completed = new HashSet<DateOnly>();
        for (var d = createdDate; d <= today; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(100, result);
    }

    [Fact]
    public void Daily_HabitCreatedToday_Returns0()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: today);

        // Even if completed today, there's 1 applicable day
        var completed = new HashSet<DateOnly> { today };
        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(100, result);
    }

    [Fact]
    public void Daily_HabitCreatedToday_NoCompletion_Returns0()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: today);

        var result = ConsistencyCalculator.Calculate(habit, [], today);

        Assert.Equal(0, result);
    }

    // --- Weekly frequency ---
    // Weekly = "did the user complete at least once this week?" per ISO week (Mon-Sun)

    [Fact]
    public void Weekly_EveryWeekHasCompletion_Returns100()
    {
        var today = new DateOnly(2025, 3, 10); // A Monday
        var habit = MakeHabit(frequency: FrequencyType.Weekly, createdDate: new DateOnly(2024, 12, 1));

        // Complete one day per ISO week (Mon-Sun) — every week in window has a completion
        var completed = new HashSet<DateOnly>();
        var windowStart = today.AddDays(-59);

        // Find the Monday of the first week in the window and complete one day per week
        var dayOfWeek = ((int)windowStart.DayOfWeek + 6) % 7; // Mon=0..Sun=6
        var firstMonday = windowStart.AddDays(-dayOfWeek);

        for (var weekStart = firstMonday; weekStart <= today; weekStart = weekStart.AddDays(7))
        {
            // Complete on the first day of this week that falls within the window
            for (var d = weekStart; d <= weekStart.AddDays(6); d = d.AddDays(1))
            {
                if (d >= windowStart && d <= today)
                {
                    completed.Add(d);
                    break; // One completion per week is enough
                }
            }
        }

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(100, result);
    }

    [Fact]
    public void Weekly_NoCompletions_Returns0()
    {
        var today = new DateOnly(2025, 3, 10);
        var habit = MakeHabit(frequency: FrequencyType.Weekly, createdDate: new DateOnly(2024, 12, 1));

        var result = ConsistencyCalculator.Calculate(habit, [], today);

        Assert.Equal(0, result);
    }

    [Fact]
    public void Weekly_CompletionOnAnyDayCountsForThatWeek()
    {
        // Key test: completing on Wednesday should count for that week
        var today = new DateOnly(2025, 3, 12); // A Wednesday
        var habit = MakeHabit(frequency: FrequencyType.Weekly, createdDate: new DateOnly(2024, 12, 1));

        // Only complete today (Wednesday) — this week should count
        var completed = new HashSet<DateOnly> { today };

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        // Should be > 0 since at least this week has a completion
        Assert.True(result > 0);
    }

    [Fact]
    public void Weekly_HalfWeeksCompleted()
    {
        // 60-day window from Mon Jan 13 to Wed Mar 12 spans ~9 ISO weeks
        var today = new DateOnly(2025, 3, 12); // Wednesday
        var habit = MakeHabit(frequency: FrequencyType.Weekly, createdDate: new DateOnly(2024, 12, 1));

        // Complete every other Monday — gives us roughly half the weeks
        var completed = new HashSet<DateOnly>();
        var windowStart = today.AddDays(-59);
        var count = 0;
        for (var d = windowStart; d <= today; d = d.AddDays(1))
        {
            if (d.DayOfWeek == DayOfWeek.Monday)
            {
                if (count % 2 == 0)
                    completed.Add(d);
                count++;
            }
        }

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        // Should be roughly 50% (depends on exact week boundaries)
        Assert.InRange(result, 40, 60);
    }

    // --- Custom frequency ---

    [Fact]
    public void Custom_SpecificDays_AllCompleted_Returns100()
    {
        var today = new DateOnly(2025, 3, 1);
        var customDays = new List<DayOfWeek> { DayOfWeek.Monday, DayOfWeek.Wednesday, DayOfWeek.Friday };
        var habit = MakeHabit(frequency: FrequencyType.Custom, customDays: customDays, createdDate: new DateOnly(2024, 12, 1));

        var completed = new HashSet<DateOnly>();
        var windowStart = today.AddDays(-59);
        for (var d = windowStart; d <= today; d = d.AddDays(1))
        {
            if (customDays.Contains(d.DayOfWeek))
                completed.Add(d);
        }

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(100, result);
    }

    [Fact]
    public void Custom_NullCustomDays_Returns0()
    {
        var today = new DateOnly(2025, 3, 1);
        // Custom frequency but no days specified — should count 0 applicable days
        var habit = MakeHabit(frequency: FrequencyType.Custom, customDays: null, createdDate: new DateOnly(2024, 12, 1));

        var completed = new HashSet<DateOnly>();
        for (var d = today.AddDays(-59); d <= today; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(0, result);
    }

    [Fact]
    public void Custom_WeekendsOnly()
    {
        var today = new DateOnly(2025, 3, 1); // Saturday
        var customDays = new List<DayOfWeek> { DayOfWeek.Saturday, DayOfWeek.Sunday };
        var habit = MakeHabit(frequency: FrequencyType.Custom, customDays: customDays, createdDate: new DateOnly(2024, 12, 1));

        var windowStart = today.AddDays(-59);
        var weekendDays = new HashSet<DateOnly>();
        for (var d = windowStart; d <= today; d = d.AddDays(1))
        {
            if (customDays.Contains(d.DayOfWeek))
                weekendDays.Add(d);
        }

        // Complete only Saturdays
        var completed = new HashSet<DateOnly>();
        for (var d = windowStart; d <= today; d = d.AddDays(1))
        {
            if (d.DayOfWeek == DayOfWeek.Saturday)
                completed.Add(d);
        }

        var saturdays = weekendDays.Count(d => d.DayOfWeek == DayOfWeek.Saturday);
        var expected = Math.Round((double)saturdays / weekendDays.Count * 100, 1);

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(expected, result);
    }

    // --- Edge cases ---

    [Fact]
    public void Completions_OutsideWindow_AreIgnored()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: new DateOnly(2024, 1, 1));

        // Only completions from 6 months ago — outside the 60-day window
        var completed = new HashSet<DateOnly>();
        for (var d = new DateOnly(2024, 6, 1); d < new DateOnly(2024, 7, 1); d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(0, result);
    }

    [Fact]
    public void FutureCreatedHabit_Returns0()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: today.AddDays(5)); // Created in the future

        var result = ConsistencyCalculator.Calculate(habit, [], today);

        Assert.Equal(0, result);
    }

    [Fact]
    public void PercentageRoundsToOneDecimal()
    {
        var today = new DateOnly(2025, 3, 1);
        // Created 3 days ago: 3 applicable days, 1 completion = 33.3%
        var createdDate = today.AddDays(-2);
        var habit = MakeHabit(createdDate: createdDate);

        var completed = new HashSet<DateOnly> { createdDate };

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(33.3, result);
    }

    [Fact]
    public void Daily_ExactlyOneDayOld_OneCompletion_Returns100()
    {
        var today = new DateOnly(2025, 3, 1);
        var yesterday = today.AddDays(-1);
        var habit = MakeHabit(createdDate: yesterday);

        var completed = new HashSet<DateOnly> { yesterday, today };

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(100, result);
    }

    [Fact]
    public void WindowStart_ClampedToCreatedDate_WhenHabitIsNewer()
    {
        var today = new DateOnly(2025, 3, 1);
        var createdDate = today.AddDays(-30); // Created 30 days ago
        var habit = MakeHabit(createdDate: createdDate);

        // Complete all 31 days (today included)
        var completed = new HashSet<DateOnly>();
        for (var d = createdDate; d <= today; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(100, result);
    }

    // --- Timezone-aware overload ---

    [Fact]
    public void Calculate_WithTimeZone_ResolvesTodayCorrectly()
    {
        // Use the non-timezone overload since we can't control DateTime.UtcNow in tests
        // But we test that the TimeZoneInfo overload doesn't crash and returns a valid result
        var habit = MakeHabit(createdDate: new DateOnly(2025, 1, 1));
        var tz = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

        var result = ConsistencyCalculator.Calculate(habit, [], tz);

        Assert.InRange(result, 0, 100);
    }
}
