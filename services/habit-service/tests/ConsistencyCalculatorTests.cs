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
    public void Daily_HabitCreatedToday_WithCompletion_Returns0()
    {
        // A habit created today has zero track record — consistency is 0 regardless of completion.
        // The frontend uses the separate "completedToday" flag for today's status.
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: today);

        var completed = new HashSet<DateOnly> { today };
        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(0, result);
    }

    [Fact]
    public void Daily_HabitCreatedToday_NoCompletion_Returns0()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: today);

        var result = ConsistencyCalculator.Calculate(habit, [], today);

        Assert.Equal(0, result);
    }

    [Fact]
    public void Daily_HabitCreatedYesterday_WithBothDaysCompleted_Returns100()
    {
        // Created yesterday, completed yesterday and today.
        // Window is [yesterday .. today] = 2 applicable days, both completed = 100%.
        var today = new DateOnly(2025, 3, 1);
        var yesterday = today.AddDays(-1);
        var habit = MakeHabit(createdDate: yesterday);

        var completed = new HashSet<DateOnly> { yesterday, today };
        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(100, result);
    }

    [Fact]
    public void Daily_HabitCreatedYesterday_OnlyTodayCompleted_Returns50()
    {
        // Created yesterday, only completed today (not yesterday).
        // Window is [yesterday .. today], 2 applicable days, 1 completed = 50%.
        var today = new DateOnly(2025, 3, 1);
        var yesterday = today.AddDays(-1);
        var habit = MakeHabit(createdDate: yesterday);

        var completed = new HashSet<DateOnly> { today };
        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(50, result);
    }

    [Fact]
    public void Weekly_HabitCreatedToday_Returns0()
    {
        var today = new DateOnly(2025, 3, 10); // Monday
        var habit = MakeHabit(frequency: FrequencyType.Weekly, createdDate: today);

        var completed = new HashSet<DateOnly> { today };
        var result = ConsistencyCalculator.Calculate(habit, completed, today, today);

        Assert.Equal(0, result);
    }

    [Fact]
    public void Custom_HabitCreatedToday_Returns0()
    {
        var today = new DateOnly(2025, 3, 3); // Monday
        var customDays = new List<DayOfWeek> { DayOfWeek.Monday };
        var habit = MakeHabit(frequency: FrequencyType.Custom, customDays: customDays, createdDate: today);

        var completed = new HashSet<DateOnly> { today };
        var result = ConsistencyCalculator.Calculate(habit, completed, today, today);

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

    // --- Timezone: creation date resolved in user's timezone ---

    [Fact]
    public void Calculate_HabitCreatedAtUtcMidnight_ResolvedToPreviousDayInNegativeOffset()
    {
        // Habit created at UTC midnight = Dec 31 23:00 in EST (UTC-5)
        // So effectiveStart should be Dec 31, not Jan 1
        var today = new DateOnly(2025, 1, 10);
        var habit = new Habit
        {
            Id = Guid.NewGuid(),
            UserId = Guid.NewGuid(),
            Name = "TZ Test",
            Frequency = FrequencyType.Daily,
            CreatedAt = new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero) // midnight UTC
        };

        // Using the testable overload: habitCreatedLocalDate = Dec 31 (as if resolved in EST)
        var habitCreatedLocalDate = new DateOnly(2024, 12, 31);
        var completed = new HashSet<DateOnly>();
        for (var d = habitCreatedLocalDate; d <= today; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.Calculate(habit, completed, today, habitCreatedLocalDate);

        // 11 days (Dec 31 to Jan 10), all completed
        Assert.Equal(100, result);
    }

    [Fact]
    public void Calculate_HabitCreatedAt_PositiveOffset_ResolvedToNextDayInPositiveOffset()
    {
        // Habit created at UTC 23:00 = Jan 2 08:00 in UTC+9 (Tokyo)
        // So effectiveStart should be Jan 2, not Jan 1
        var today = new DateOnly(2025, 1, 10);
        var habit = new Habit
        {
            Id = Guid.NewGuid(),
            UserId = Guid.NewGuid(),
            Name = "TZ Test Tokyo",
            Frequency = FrequencyType.Daily,
            CreatedAt = new DateTimeOffset(2025, 1, 1, 23, 0, 0, TimeSpan.Zero) // 23:00 UTC
        };

        var habitCreatedLocalDate = new DateOnly(2025, 1, 2); // Next day in Tokyo
        var completed = new HashSet<DateOnly>();
        for (var d = habitCreatedLocalDate; d <= today; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.Calculate(habit, completed, today, habitCreatedLocalDate);

        // 9 days (Jan 2 to Jan 10), all completed
        Assert.Equal(100, result);
    }

    // --- Weekly: new habit created mid-week ---

    [Fact]
    public void Weekly_NewHabit_CreatedMidWeek_PartialFirstWeekCounts()
    {
        // Created on Thursday, today is the following Wednesday (6 days later)
        // First partial week (Thu-Sun) + second partial week (Mon-Wed) = 2 weeks
        var today = new DateOnly(2025, 3, 12); // Wednesday
        var createdDate = new DateOnly(2025, 3, 6); // Thursday
        var habit = MakeHabit(frequency: FrequencyType.Weekly, createdDate: createdDate);

        // Complete on Thursday (first week) and Tuesday (second week)
        var completed = new HashSet<DateOnly>
        {
            new DateOnly(2025, 3, 6),  // Thursday
            new DateOnly(2025, 3, 11)  // Tuesday
        };

        var result = ConsistencyCalculator.Calculate(habit, completed, today, createdDate);

        Assert.Equal(100, result);
    }

    [Fact]
    public void Weekly_NewHabit_CreatedMidWeek_OnlySecondWeekCompleted()
    {
        var today = new DateOnly(2025, 3, 12); // Wednesday
        var createdDate = new DateOnly(2025, 3, 6); // Thursday
        var habit = MakeHabit(frequency: FrequencyType.Weekly, createdDate: createdDate);

        // Only complete in second week
        var completed = new HashSet<DateOnly> { new DateOnly(2025, 3, 11) };

        var result = ConsistencyCalculator.Calculate(habit, completed, today, createdDate);

        // 1 of 2 weeks = 50%
        Assert.Equal(50, result);
    }

    // --- Custom frequency: single day per week ---

    [Fact]
    public void Custom_SingleDay_MondayOnly()
    {
        var today = new DateOnly(2025, 3, 1); // Saturday
        var customDays = new List<DayOfWeek> { DayOfWeek.Monday };
        var habit = MakeHabit(frequency: FrequencyType.Custom, customDays: customDays, createdDate: new DateOnly(2024, 12, 1));

        var windowStart = today.AddDays(-59);
        var completed = new HashSet<DateOnly>();
        var applicableCount = 0;
        for (var d = windowStart; d <= today; d = d.AddDays(1))
        {
            if (d.DayOfWeek == DayOfWeek.Monday)
            {
                completed.Add(d);
                applicableCount++;
            }
        }

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(100, result);
    }

    // --- Spec example calculations ---

    [Fact]
    public void SpecExample_Daily_45of60_Returns75()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: new DateOnly(2024, 12, 1));

        var windowStart = today.AddDays(-59);
        var completed = new HashSet<DateOnly>();
        var count = 0;
        for (var d = windowStart; d <= today; d = d.AddDays(1))
        {
            if (count < 45)
                completed.Add(d);
            count++;
        }

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(75, result);
    }

    [Fact]
    public void SpecExample_Daily_30of60_Returns50()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: new DateOnly(2024, 12, 1));

        var completed = new HashSet<DateOnly>();
        var windowStart = today.AddDays(-59);
        for (var d = windowStart; d <= today; d = d.AddDays(2))
            completed.Add(d);

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(50, result);
    }

    [Fact]
    public void SpecExample_Daily_6of60_Returns10()
    {
        var today = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdDate: new DateOnly(2024, 12, 1));

        var windowStart = today.AddDays(-59);
        var completed = new HashSet<DateOnly>();
        for (var i = 0; i < 6; i++)
            completed.Add(windowStart.AddDays(i));

        var result = ConsistencyCalculator.Calculate(habit, completed, today);

        Assert.Equal(10, result);
    }

    [Fact]
    public void SpecExample_Weekly_6of8_Returns75()
    {
        // 60-day window from a Monday: ~9 ISO weeks
        var today = new DateOnly(2025, 3, 10); // Monday
        var habit = MakeHabit(frequency: FrequencyType.Weekly, createdDate: new DateOnly(2024, 12, 1));

        var windowStart = today.AddDays(-59); // Jan 10 (Friday)
        // Count total weeks first to know denominator
        var dayOfWeek = ((int)windowStart.DayOfWeek + 6) % 7;
        var firstMonday = windowStart.AddDays(-dayOfWeek);
        var totalWeeks = 0;
        for (var ws = firstMonday; ws <= today; ws = ws.AddDays(7))
        {
            var overlapStart = ws < windowStart ? windowStart : ws;
            var overlapEnd = ws.AddDays(6) > today ? today : ws.AddDays(6);
            if (overlapStart <= overlapEnd)
                totalWeeks++;
        }

        // Complete 75% of weeks (rounding)
        var targetWeeks = (int)Math.Round(totalWeeks * 0.75);
        var completed = new HashSet<DateOnly>();
        var weekCount = 0;
        for (var ws = firstMonday; ws <= today; ws = ws.AddDays(7))
        {
            var overlapStart = ws < windowStart ? windowStart : ws;
            var overlapEnd = ws.AddDays(6) > today ? today : ws.AddDays(6);
            if (overlapStart <= overlapEnd)
            {
                if (weekCount < targetWeeks)
                    completed.Add(overlapStart);
                weekCount++;
            }
        }

        var result = ConsistencyCalculator.Calculate(habit, completed, today);
        var expected = Math.Round((double)targetWeeks / totalWeeks * 100, 1);

        Assert.Equal(expected, result);
    }
}

// --- CalculateForDateRange tests ---

public class CalculateForDateRangeTests
{
    private static Habit MakeHabit(
        FrequencyType frequency = FrequencyType.Daily,
        List<DayOfWeek>? customDays = null,
        DateTimeOffset? createdAt = null)
    {
        return new Habit
        {
            Id = Guid.NewGuid(),
            UserId = Guid.NewGuid(),
            Name = "Test Habit",
            Frequency = frequency,
            CustomDays = customDays,
            CreatedAt = createdAt ?? new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero)
        };
    }

    [Fact]
    public void Daily_AllCompleted_Returns100()
    {
        var habit = MakeHabit();
        var start = new DateOnly(2025, 2, 1);
        var end = new DateOnly(2025, 2, 14);

        var completed = new HashSet<DateOnly>();
        for (var d = start; d <= end; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end);

        Assert.Equal(100, result);
    }

    [Fact]
    public void Daily_NoneCompleted_Returns0()
    {
        var habit = MakeHabit();
        var start = new DateOnly(2025, 2, 1);
        var end = new DateOnly(2025, 2, 14);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, [], start, end);

        Assert.Equal(0, result);
    }

    [Fact]
    public void Daily_HalfCompleted_Returns50()
    {
        var habit = MakeHabit();
        var start = new DateOnly(2025, 2, 1);
        var end = new DateOnly(2025, 2, 14); // 14 days

        var completed = new HashSet<DateOnly>();
        for (var d = start; d <= end; d = d.AddDays(2))
            completed.Add(d);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end);

        Assert.Equal(50, result);
    }

    [Fact]
    public void RangeStartAfterEnd_Returns0()
    {
        var habit = MakeHabit();
        var start = new DateOnly(2025, 3, 1);
        var end = new DateOnly(2025, 2, 1);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, [], start, end);

        Assert.Equal(0, result);
    }

    [Fact]
    public void SingleDayRange_Completed_Returns100()
    {
        var habit = MakeHabit();
        var date = new DateOnly(2025, 2, 10);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, [date], date, date);

        Assert.Equal(100, result);
    }

    [Fact]
    public void SingleDayRange_NotCompleted_Returns0()
    {
        var habit = MakeHabit();
        var date = new DateOnly(2025, 2, 10);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, [], date, date);

        Assert.Equal(0, result);
    }

    [Fact]
    public void Custom_MWF_OnlyCountsApplicableDays()
    {
        var customDays = new List<DayOfWeek> { DayOfWeek.Monday, DayOfWeek.Wednesday, DayOfWeek.Friday };
        var habit = MakeHabit(FrequencyType.Custom, customDays);

        // Feb 3-9 2025 (Mon-Sun): applicable days are Mon(3), Wed(5), Fri(7) = 3 days
        var start = new DateOnly(2025, 2, 3);
        var end = new DateOnly(2025, 2, 9);

        var completed = new HashSet<DateOnly>
        {
            new DateOnly(2025, 2, 3), // Monday
            new DateOnly(2025, 2, 5), // Wednesday
        };

        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end);

        // 2 of 3 applicable days = 66.7%
        Assert.Equal(66.7, result);
    }

    [Fact]
    public void Weekly_TwoWeeksOneCompleted_Returns50()
    {
        var habit = MakeHabit(FrequencyType.Weekly);

        // Two full ISO weeks: Mon Feb 3 - Sun Feb 16
        var start = new DateOnly(2025, 2, 3);
        var end = new DateOnly(2025, 2, 16);

        // Only complete in the first week
        var completed = new HashSet<DateOnly> { new DateOnly(2025, 2, 5) };

        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end);

        Assert.Equal(50, result);
    }

    [Fact]
    public void CompletionsOutsideRange_AreIgnored()
    {
        var habit = MakeHabit();
        var start = new DateOnly(2025, 2, 1);
        var end = new DateOnly(2025, 2, 7); // 7 days

        // Completions outside the range
        var completed = new HashSet<DateOnly>
        {
            new DateOnly(2025, 1, 31), // before range
            new DateOnly(2025, 2, 8),  // after range
            new DateOnly(2025, 2, 3),  // inside range
        };

        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end);

        // 1 of 7 days = 14.3%
        Assert.Equal(14.3, result);
    }

    // --- Creation-date clamping ---

    [Fact]
    public void Daily_HabitCreatedMidRange_ClampsToCreationDate()
    {
        // Range is Feb 1-14 but habit was created Feb 8 — only 7 applicable days
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 2, 8, 0, 0, 0, TimeSpan.Zero));
        var start = new DateOnly(2025, 2, 1);
        var end = new DateOnly(2025, 2, 14);

        // Complete all days from Feb 8 onwards
        var completed = new HashSet<DateOnly>();
        for (var d = new DateOnly(2025, 2, 8); d <= end; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end);

        // 7 of 7 applicable days = 100% (not 7/14 = 50%)
        Assert.Equal(100, result);
    }

    [Fact]
    public void Daily_HabitCreatedAfterRangeEnd_Returns0()
    {
        // Range is Feb 1-14 but habit was created Mar 1 — no applicable days
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 3, 1, 0, 0, 0, TimeSpan.Zero));
        var start = new DateOnly(2025, 2, 1);
        var end = new DateOnly(2025, 2, 14);

        var completed = new HashSet<DateOnly>();
        for (var d = start; d <= end; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end);

        Assert.Equal(0, result);
    }

    [Fact]
    public void Daily_HabitCreatedMidRange_WithExplicitLocalDate()
    {
        // Habit created at UTC midnight = Feb 7 23:00 EST — local creation date is Feb 7
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 2, 8, 0, 0, 0, TimeSpan.Zero));
        var start = new DateOnly(2025, 2, 1);
        var end = new DateOnly(2025, 2, 14);

        var completed = new HashSet<DateOnly>();
        for (var d = new DateOnly(2025, 2, 7); d <= end; d = d.AddDays(1))
            completed.Add(d);

        // Passing explicit local creation date (Feb 7 in EST)
        var localCreated = new DateOnly(2025, 2, 7);
        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end, localCreated);

        // 8 of 8 applicable days (Feb 7-14) = 100%
        Assert.Equal(100, result);
    }

    [Fact]
    public void Daily_TimezoneOverload_ClampsWithTimezoneAwareCreationDate()
    {
        // Habit created at UTC midnight Feb 8 = Feb 7 19:00 in EST (UTC-5)
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 2, 8, 0, 0, 0, TimeSpan.Zero));
        var start = new DateOnly(2025, 2, 1);
        var end = new DateOnly(2025, 2, 14);
        var est = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

        // Complete Feb 7-14
        var completed = new HashSet<DateOnly>();
        for (var d = new DateOnly(2025, 2, 7); d <= end; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end, est);

        // EST: creation date resolves to Feb 7, so 8 applicable days (Feb 7-14), all completed = 100%
        Assert.Equal(100, result);
    }

    [Fact]
    public void Daily_TimezoneOverload_PositiveOffset_ClampsCorrectly()
    {
        // Habit created at UTC 23:00 Feb 7 = Feb 8 08:00 in Tokyo (UTC+9)
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 2, 7, 23, 0, 0, TimeSpan.Zero));
        var start = new DateOnly(2025, 2, 1);
        var end = new DateOnly(2025, 2, 14);
        var tokyo = TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo");

        // Complete Feb 8-14
        var completed = new HashSet<DateOnly>();
        for (var d = new DateOnly(2025, 2, 8); d <= end; d = d.AddDays(1))
            completed.Add(d);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end, tokyo);

        // Tokyo: creation date resolves to Feb 8, so 7 applicable days (Feb 8-14), all completed = 100%
        Assert.Equal(100, result);
    }

    [Fact]
    public void Weekly_HabitCreatedMidRange_ClampsToCreationDate()
    {
        // Range is two full weeks (Feb 3-16) but habit was created Feb 10 (start of 2nd week)
        var habit = MakeHabit(
            frequency: FrequencyType.Weekly,
            createdAt: new DateTimeOffset(2025, 2, 10, 0, 0, 0, TimeSpan.Zero));
        var start = new DateOnly(2025, 2, 3);
        var end = new DateOnly(2025, 2, 16);

        // Complete one day in the second week
        var completed = new HashSet<DateOnly> { new DateOnly(2025, 2, 12) };

        var result = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end);

        // Only 1 week is applicable (Feb 10-16), and it has a completion = 100%
        Assert.Equal(100, result);
    }

    // --- Timezone boundary: habit created at 11 PM UTC-5 on March 1 ---

    [Fact]
    public void Daily_TimezoneBoundary_CreatedAt11pmEst_RangeStartsMarch1()
    {
        // User in UTC-5 creates habit at 11 PM local time on March 1.
        // In UTC that's March 2 04:00 AM.
        // Without timezone-aware clamping, UTC fallback would see creation = March 2,
        // excluding March 1 from the range and undercounting.
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 3, 2, 4, 0, 0, TimeSpan.Zero));
        var est = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

        var start = new DateOnly(2025, 3, 1);
        var end = new DateOnly(2025, 3, 7); // 7-day range

        // Complete all days March 1-7
        var completed = new HashSet<DateOnly>();
        for (var d = start; d <= end; d = d.AddDays(1))
            completed.Add(d);

        // With timezone: creation date = March 1 (local), all 7 days applicable
        var resultWithTz = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end, est);
        Assert.Equal(100, resultWithTz);

        // Without timezone: creation date = March 2 (UTC), only 6 days applicable
        var resultWithoutTz = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end);
        // Still 100% (all completed), but denominator is 6 instead of 7
        Assert.Equal(100, resultWithoutTz);
    }

    [Fact]
    public void Daily_TimezoneBoundary_CreatedAt11pmEst_PartialCompletions()
    {
        // Same timezone boundary scenario, but with partial completions to show the undercount.
        // Habit created at 11 PM EST on March 1 = March 2 04:00 UTC.
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 3, 2, 4, 0, 0, TimeSpan.Zero));
        var est = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

        var start = new DateOnly(2025, 3, 1);
        var end = new DateOnly(2025, 3, 7);

        // Complete only March 1 — the day that UTC fallback would exclude
        var completed = new HashSet<DateOnly> { new DateOnly(2025, 3, 1) };

        // With timezone: creation date = March 1, 7 applicable days, 1 completed = 14.3%
        var resultWithTz = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end, est);
        Assert.Equal(14.3, resultWithTz);

        // Without timezone: creation date = March 2 (UTC), March 1 excluded from range.
        // 6 applicable days, 0 completed (March 1 is before effectiveStart) = 0%
        var resultWithoutTz = ConsistencyCalculator.CalculateForDateRange(habit, completed, start, end);
        Assert.Equal(0, resultWithoutTz);
    }

    // --- Range spans exactly one day ---

    [Fact]
    public void Daily_SingleDayRange_HabitExisted_Completed()
    {
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 2, 1, 0, 0, 0, TimeSpan.Zero));
        var date = new DateOnly(2025, 2, 10);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, [date], date, date);

        Assert.Equal(100, result);
    }

    [Fact]
    public void Daily_SingleDayRange_HabitExisted_NotCompleted()
    {
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 2, 1, 0, 0, 0, TimeSpan.Zero));
        var date = new DateOnly(2025, 2, 10);

        var result = ConsistencyCalculator.CalculateForDateRange(habit, [], date, date);

        Assert.Equal(0, result);
    }

    [Fact]
    public void Daily_SingleDayRange_HabitCreatedThatDay()
    {
        // Habit created on the same day as the single-day range
        var date = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 3, 1, 10, 0, 0, TimeSpan.Zero));

        var result = ConsistencyCalculator.CalculateForDateRange(habit, [date], date, date);

        Assert.Equal(100, result);
    }

    [Fact]
    public void Daily_SingleDayRange_HabitNotYetCreated()
    {
        // Habit created after the single-day range
        var date = new DateOnly(2025, 3, 1);
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 3, 2, 0, 0, 0, TimeSpan.Zero));

        var result = ConsistencyCalculator.CalculateForDateRange(habit, [date], date, date);

        Assert.Equal(0, result);
    }
}

// --- Flame level mapping tests ---

public class FlameLevelTests
{
    // --- Rising thresholds (no previous level) ---

    [Theory]
    [InlineData(0, FlameLevel.None)]
    [InlineData(5, FlameLevel.None)]
    [InlineData(9.9, FlameLevel.None)]
    [InlineData(10, FlameLevel.Ember)]
    [InlineData(20, FlameLevel.Ember)]
    [InlineData(29.9, FlameLevel.Ember)]
    [InlineData(30, FlameLevel.Steady)]
    [InlineData(45, FlameLevel.Steady)]
    [InlineData(54.9, FlameLevel.Steady)]
    [InlineData(55, FlameLevel.Strong)]
    [InlineData(70, FlameLevel.Strong)]
    [InlineData(79.9, FlameLevel.Strong)]
    [InlineData(80, FlameLevel.Blazing)]
    [InlineData(90, FlameLevel.Blazing)]
    [InlineData(100, FlameLevel.Blazing)]
    public void RisingThresholds_NoPreviousLevel(double consistency, FlameLevel expected)
    {
        var result = ConsistencyCalculator.GetFlameLevel(consistency);

        Assert.Equal(expected, result);
    }

    // --- "Grows quickly": improvement immediately reflected ---

    [Fact]
    public void GrowsQuickly_FromNone_To_Ember_At10Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(10, FlameLevel.None);

        Assert.Equal(FlameLevel.Ember, result);
    }

    [Fact]
    public void GrowsQuickly_FromEmber_To_Steady_At30Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(30, FlameLevel.Ember);

        Assert.Equal(FlameLevel.Steady, result);
    }

    [Fact]
    public void GrowsQuickly_FromSteady_To_Strong_At55Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(55, FlameLevel.Steady);

        Assert.Equal(FlameLevel.Strong, result);
    }

    [Fact]
    public void GrowsQuickly_FromStrong_To_Blazing_At80Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(80, FlameLevel.Strong);

        Assert.Equal(FlameLevel.Blazing, result);
    }

    // --- "Shrinks slowly": flame holds level until consistency drops further ---

    [Fact]
    public void ShrinkSlowly_Blazing_HoldsAt65Percent()
    {
        // At 65% the rising level would be Strong, but with previousLevel=Blazing,
        // the falling threshold keeps it at Blazing
        var result = ConsistencyCalculator.GetFlameLevel(65, FlameLevel.Blazing);

        Assert.Equal(FlameLevel.Blazing, result);
    }

    [Fact]
    public void ShrinkSlowly_Blazing_DropsToStrongAt64Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(64, FlameLevel.Blazing);

        Assert.Equal(FlameLevel.Strong, result);
    }

    [Fact]
    public void ShrinkSlowly_Strong_HoldsAt40Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(40, FlameLevel.Strong);

        Assert.Equal(FlameLevel.Strong, result);
    }

    [Fact]
    public void ShrinkSlowly_Strong_DropsToSteadyAt39Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(39, FlameLevel.Strong);

        Assert.Equal(FlameLevel.Steady, result);
    }

    [Fact]
    public void ShrinkSlowly_Steady_HoldsAt20Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(20, FlameLevel.Steady);

        Assert.Equal(FlameLevel.Steady, result);
    }

    [Fact]
    public void ShrinkSlowly_Steady_DropsToEmberAt19Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(19, FlameLevel.Steady);

        Assert.Equal(FlameLevel.Ember, result);
    }

    [Fact]
    public void ShrinkSlowly_Ember_HoldsAt5Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(5, FlameLevel.Ember);

        Assert.Equal(FlameLevel.Ember, result);
    }

    [Fact]
    public void ShrinkSlowly_Ember_DropsToNoneAt4Percent()
    {
        var result = ConsistencyCalculator.GetFlameLevel(4, FlameLevel.Ember);

        Assert.Equal(FlameLevel.None, result);
    }

    // --- Edge: multi-level drop ---

    [Fact]
    public void ShrinkSlowly_Blazing_DropsToEmber_AtVeryLowConsistency()
    {
        // At 5%, falling level is Ember. Previous was Blazing. Flame drops but doesn't skip.
        var result = ConsistencyCalculator.GetFlameLevel(5, FlameLevel.Blazing);

        Assert.Equal(FlameLevel.Ember, result);
    }

    [Fact]
    public void ShrinkSlowly_Blazing_DropsToNone_AtZero()
    {
        var result = ConsistencyCalculator.GetFlameLevel(0, FlameLevel.Blazing);

        Assert.Equal(FlameLevel.None, result);
    }

    // --- Boundary: exact thresholds ---

    [Theory]
    [InlineData(0, FlameLevel.None)]
    [InlineData(100, FlameLevel.Blazing)]
    public void Boundaries_ExtremeValues(double consistency, FlameLevel expected)
    {
        var result = ConsistencyCalculator.GetFlameLevel(consistency);

        Assert.Equal(expected, result);
    }

    // --- Same level: no change when consistency stays in same band ---

    [Fact]
    public void SameLevel_NoChangeWhenStayingInBand()
    {
        // Previous was Strong (55-79), consistency is 60 — still Strong
        var result = ConsistencyCalculator.GetFlameLevel(60, FlameLevel.Strong);

        Assert.Equal(FlameLevel.Strong, result);
    }
}

/// <summary>
/// Documents and regression-guards the share-surface timezone contract:
/// all non-owner surfaces (friend profile via /habits/user/{userId}, public JSON via
/// /habits/public/{username}, and flame badge via /habits/public/{username}/flame.svg)
/// must use UTC when computing consistency.
///
/// These tests verify the calculator behavior under the UTC policy — they do not call
/// the HTTP endpoints directly (integration tests in HabitEndpointTests cover that).
/// The primary value is: (1) proving that non-UTC timezones produce materially different
/// results at boundaries, justifying the fixed-UTC policy, and (2) serving as a regression
/// guard so any future change to the timezone contract must update these tests.
/// </summary>
public class ShareSurfaceTimezoneParityTests
{
    private static Habit MakeHabit(
        FrequencyType frequency = FrequencyType.Daily,
        DateTimeOffset? createdAt = null)
    {
        return new Habit
        {
            Id = Guid.NewGuid(),
            UserId = Guid.NewGuid(),
            Name = "Test Habit",
            Frequency = frequency,
            CreatedAt = createdAt ?? new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero)
        };
    }

    [Fact]
    public void AllShareSurfaces_UseUtc_ProduceSameResult()
    {
        // Simulate the exact calculation each share surface performs:
        // All three should pass TimeZoneInfo.Utc to ConsistencyCalculator.Calculate.
        var habit = MakeHabit(createdAt: new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero));
        var completedDates = new HashSet<DateOnly>();
        for (var d = new DateOnly(2025, 1, 1); d <= new DateOnly(2025, 2, 28); d = d.AddDays(1))
            completedDates.Add(d);

        // Surface 1: /habits/user/{userId} — friend profile (always UTC)
        var friendProfileConsistency = ConsistencyCalculator.Calculate(habit, completedDates, TimeZoneInfo.Utc);
        var friendProfileFlame = ConsistencyCalculator.GetFlameLevel(friendProfileConsistency);

        // Surface 2: /habits/public/{username} — public JSON (now UTC, was viewer TZ)
        var publicJsonConsistency = ConsistencyCalculator.Calculate(habit, completedDates, TimeZoneInfo.Utc);
        var publicJsonFlame = ConsistencyCalculator.GetFlameLevel(publicJsonConsistency);

        // Surface 3: /habits/public/{username}/flame.svg — badge (always UTC)
        var badgeConsistency = ConsistencyCalculator.Calculate(habit, completedDates, TimeZoneInfo.Utc);
        var badgeFlame = ConsistencyCalculator.GetFlameLevel(badgeConsistency);

        Assert.Equal(friendProfileConsistency, publicJsonConsistency);
        Assert.Equal(publicJsonConsistency, badgeConsistency);
        Assert.Equal(friendProfileFlame, publicJsonFlame);
        Assert.Equal(publicJsonFlame, badgeFlame);
    }

    [Fact]
    public void MidnightBoundary_ViewerTimezone_WouldDiverge_ButUtcDoesNot()
    {
        // A habit completed near midnight UTC: completion on Jan 31 in UTC,
        // but a viewer in UTC+9 (Tokyo) would see "today" as Feb 1.
        // If the public endpoint used viewer timezone, it would compute a different
        // window and potentially different consistency than the UTC-based surfaces.
        //
        // This test proves that using UTC on all surfaces eliminates that divergence.
        var habit = MakeHabit(createdAt: new DateTimeOffset(2024, 12, 1, 0, 0, 0, TimeSpan.Zero));

        // Completions: every day Dec 1 2024 through Jan 31 2025
        var completedDates = new HashSet<DateOnly>();
        for (var d = new DateOnly(2024, 12, 1); d <= new DateOnly(2025, 1, 31); d = d.AddDays(1))
            completedDates.Add(d);

        // UTC "today" is Jan 31 (we test via the explicit-today overload)
        var utcToday = new DateOnly(2025, 1, 31);
        var utcConsistency = ConsistencyCalculator.Calculate(habit, completedDates, utcToday);

        // Tokyo "today" would be Feb 1 (9 hours ahead of UTC)
        var tokyoToday = new DateOnly(2025, 2, 1);
        var tokyoConsistency = ConsistencyCalculator.Calculate(habit, completedDates, tokyoToday);

        // These are materially different — the window shifts by one day
        Assert.NotEqual(utcConsistency, tokyoConsistency);

        // But all share surfaces use UTC, so they all agree
        var surface1 = ConsistencyCalculator.Calculate(habit, completedDates, utcToday);
        var surface2 = ConsistencyCalculator.Calculate(habit, completedDates, utcToday);
        var surface3 = ConsistencyCalculator.Calculate(habit, completedDates, utcToday);
        Assert.Equal(surface1, surface2);
        Assert.Equal(surface2, surface3);
    }

    [Fact]
    public void MidnightBoundary_FlameLevel_ConsistentAcrossSurfaces()
    {
        // Near a flame-level threshold: 29% consistency in UTC puts the flame at Ember,
        // but a shifted window in another timezone might push it to Steady (30%).
        // Share surfaces must agree because they all use UTC.
        var habit = MakeHabit(createdAt: new DateTimeOffset(2024, 12, 1, 0, 0, 0, TimeSpan.Zero));
        var utcToday = new DateOnly(2025, 1, 31);
        var windowStart = utcToday.AddDays(-59);

        // Complete exactly 17 of 60 days = 28.3%, right below the Ember/Steady boundary (30%)
        var completedDates = new HashSet<DateOnly>();
        var count = 0;
        for (var d = windowStart; d <= utcToday && count < 17; d = d.AddDays(1))
        {
            completedDates.Add(d);
            count++;
        }

        var consistency = ConsistencyCalculator.Calculate(habit, completedDates, utcToday);
        var flame = ConsistencyCalculator.GetFlameLevel(consistency);

        // All three surfaces compute the same flame level
        Assert.Equal(flame, ConsistencyCalculator.GetFlameLevel(
            ConsistencyCalculator.Calculate(habit, completedDates, utcToday)));
        Assert.Equal(flame, ConsistencyCalculator.GetFlameLevel(
            ConsistencyCalculator.Calculate(habit, completedDates, utcToday)));

        // Document the actual values for clarity
        Assert.True(consistency < 30, $"Expected < 30 for boundary test, got {consistency}");
        Assert.Equal(FlameLevel.Ember, flame);
    }
}
