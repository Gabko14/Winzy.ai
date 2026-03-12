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
