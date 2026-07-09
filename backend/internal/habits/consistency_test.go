package habits

import (
	"math"
	"testing"
	"time"
)

// This file ports EVERY test in
// services/habit-service/tests/ConsistencyCalculatorTests.cs, preserving each
// case's inputs and expected values exactly (a C# expectation is the spec — it
// is never adjusted to match the Go output). It then adds the acceptance
// criteria's extra coverage: backfill-before-creation, DST transitions,
// date-line timezones, weekly best-kind mixes, minimum-weight mixes, rounding
// midpoints, empty window, and day-old habits. The rounding table
// (TestRoundNET_MatchesDotNet) is captured from a live .NET 10 run and is the
// explicit banker's-rounding regression the bead requires.

// --- helpers ---

// day builds a civil date as a UTC-midnight time.Time — the shape the
// calculator reads (only Y/M/D matter). Mirrors the C# tests' new
// DateOnly(y, m, d).
func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func withKind(kind CompletionKind, dates ...time.Time) []DatedCompletion {
	out := make([]DatedCompletion, len(dates))
	for i, d := range dates {
		out[i] = DatedCompletion{LocalDate: d, Kind: kind}
	}
	return out
}

func full(dates ...time.Time) []DatedCompletion { return withKind(CompletionFull, dates...) }

// daysInclusive returns every date in [start, end], the Go analogue of the C#
// tests' `for (var d = start; d <= end; d = d.AddDays(1))` loops.
func daysInclusive(start, end time.Time) []time.Time {
	var out []time.Time
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		out = append(out, d)
	}
	return out
}

func assertEq(t *testing.T, got, want float64, name string) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %v, want %v", name, got, want)
	}
}

// daily/custom convenience: no weekly, no custom days.
func calcDaily(completions []DatedCompletion, today, created time.Time) float64 {
	return Calculate(FrequencyDaily, nil, completions, today, created)
}

// --- Daily frequency (ConsistencyCalculatorTests) ---

func TestDaily(t *testing.T) {
	today := day(2025, 3, 1)
	oldCreated := day(2024, 12, 1)
	windowStart := today.AddDate(0, 0, -59)

	t.Run("AllDaysCompleted_Returns100", func(t *testing.T) {
		c := full(daysInclusive(windowStart, today)...)
		assertEq(t, calcDaily(c, today, oldCreated), 100, "all days")
	})

	t.Run("NoDaysCompleted_Returns0", func(t *testing.T) {
		assertEq(t, calcDaily(nil, today, oldCreated), 0, "none")
	})

	t.Run("HalfDaysCompleted_Returns50", func(t *testing.T) {
		var dates []time.Time
		for d := windowStart; !d.After(today); d = d.AddDate(0, 0, 2) {
			dates = append(dates, d)
		}
		assertEq(t, calcDaily(full(dates...), today, oldCreated), 50, "every other day")
	})

	t.Run("NewHabit_OnlyCountsDaysSinceCreation", func(t *testing.T) {
		created := today.AddDate(0, 0, -9)
		c := full(daysInclusive(created, today)...)
		assertEq(t, calcDaily(c, today, created), 100, "10 days all completed")
	})

	t.Run("HabitCreatedToday_WithCompletion_Returns100", func(t *testing.T) {
		assertEq(t, calcDaily(full(today), today, today), 100, "created today, done")
	})

	t.Run("HabitCreatedToday_NoCompletion_Returns0", func(t *testing.T) {
		assertEq(t, calcDaily(nil, today, today), 0, "created today, not done")
	})

	t.Run("HabitCreatedYesterday_WithBothDaysCompleted_Returns100", func(t *testing.T) {
		yesterday := today.AddDate(0, 0, -1)
		assertEq(t, calcDaily(full(yesterday, today), today, yesterday), 100, "both days")
	})

	t.Run("HabitCreatedYesterday_OnlyTodayCompleted_Returns50", func(t *testing.T) {
		yesterday := today.AddDate(0, 0, -1)
		assertEq(t, calcDaily(full(today), today, yesterday), 50, "one of two")
	})

	t.Run("BackfilledCompletionsBeforeCreation_CountFromFirstBackfilledDate", func(t *testing.T) {
		created := day(2025, 3, 3)
		c := full(created.AddDate(0, 0, -2), created.AddDate(0, 0, -1), created)
		assertEq(t, calcDaily(c, created, created), 100, "backfill before creation")
	})

	t.Run("ExactlyOneDayOld_OneCompletion_Returns100", func(t *testing.T) {
		yesterday := today.AddDate(0, 0, -1)
		assertEq(t, calcDaily(full(yesterday, today), today, yesterday), 100, "one day old")
	})

	t.Run("WindowStart_ClampedToCreatedDate_WhenHabitIsNewer", func(t *testing.T) {
		created := today.AddDate(0, 0, -30)
		c := full(daysInclusive(created, today)...)
		assertEq(t, calcDaily(c, today, created), 100, "31 days all completed")
	})
}

// --- New-habit / creation-date edge cases (ConsistencyCalculatorTests) ---

func TestDaily_CreationEdges(t *testing.T) {
	today := day(2025, 3, 1)

	t.Run("Completions_OutsideWindow_AreIgnored", func(t *testing.T) {
		created := day(2024, 1, 1)
		c := full(daysInclusive(day(2024, 6, 1), day(2024, 6, 30))...)
		assertEq(t, calcDaily(c, today, created), 0, "old completions ignored")
	})

	t.Run("FutureCreatedHabit_Returns0", func(t *testing.T) {
		created := today.AddDate(0, 0, 5)
		assertEq(t, calcDaily(nil, today, created), 0, "future creation")
	})

	t.Run("PercentageRoundsToOneDecimal", func(t *testing.T) {
		created := today.AddDate(0, 0, -2) // 3 applicable days
		assertEq(t, calcDaily(full(created), today, created), 33.3, "1 of 3 = 33.3")
	})
}

// --- Timezone-resolved creation date (ConsistencyCalculatorTests) ---

func TestDaily_TimezoneResolvedCreation(t *testing.T) {
	t.Run("CreatedAtUtcMidnight_ResolvedToPreviousDayInNegativeOffset", func(t *testing.T) {
		today := day(2025, 1, 10)
		created := day(2024, 12, 31) // as if resolved in EST
		c := full(daysInclusive(created, today)...)
		assertEq(t, calcDaily(c, today, created), 100, "11 days from Dec 31")
	})

	t.Run("PositiveOffset_ResolvedToNextDayInPositiveOffset", func(t *testing.T) {
		today := day(2025, 1, 10)
		created := day(2025, 1, 2) // next day in Tokyo
		c := full(daysInclusive(created, today)...)
		assertEq(t, calcDaily(c, today, created), 100, "9 days from Jan 2")
	})
}

// Consistency's TimeZoneInfo-equivalent overload resolves "today" from the
// wall clock in loc without crashing and stays in range — mirrors
// Calculate_WithTimeZone_ResolvesTodayCorrectly.
func TestConsistency_WithTimeZone_InRange(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("loading tz: %v", err)
	}
	h := Habit{Frequency: FrequencyDaily, CreatedAt: day(2025, 1, 1)}
	got := Consistency(h, nil, loc)
	if got < 0 || got > 100 {
		t.Errorf("consistency out of range: %v", got)
	}
}

// --- Weekly frequency (ConsistencyCalculatorTests) ---

func TestWeekly(t *testing.T) {
	weekly := func(c []DatedCompletion, today, created time.Time) float64 {
		return Calculate(FrequencyWeekly, nil, c, today, created)
	}

	t.Run("EveryWeekHasCompletion_Returns100", func(t *testing.T) {
		today := day(2025, 3, 10) // Monday
		created := day(2024, 12, 1)
		var dates []time.Time
		for _, d := range oneCompletionPerWeek(today.AddDate(0, 0, -59), today) {
			dates = append(dates, d)
		}
		assertEq(t, weekly(full(dates...), today, created), 100, "one per week")
	})

	t.Run("NoCompletions_Returns0", func(t *testing.T) {
		today := day(2025, 3, 10)
		assertEq(t, weekly(nil, today, day(2024, 12, 1)), 0, "none")
	})

	t.Run("CompletionOnAnyDayCountsForThatWeek", func(t *testing.T) {
		today := day(2025, 3, 12) // Wednesday
		got := weekly(full(today), today, day(2024, 12, 1))
		if got <= 0 {
			t.Errorf("expected > 0, got %v", got)
		}
	})

	t.Run("HalfWeeksCompleted_InRange40to60", func(t *testing.T) {
		today := day(2025, 3, 12)
		windowStart := today.AddDate(0, 0, -59)
		var dates []time.Time
		count := 0
		for d := windowStart; !d.After(today); d = d.AddDate(0, 0, 1) {
			if d.Weekday() == time.Monday {
				if count%2 == 0 {
					dates = append(dates, d)
				}
				count++
			}
		}
		got := weekly(full(dates...), today, day(2024, 12, 1))
		if got < 40 || got > 60 {
			t.Errorf("expected 40..60, got %v", got)
		}
	})

	t.Run("NewHabit_CreatedMidWeek_PartialFirstWeekCounts", func(t *testing.T) {
		today := day(2025, 3, 12)  // Wednesday
		created := day(2025, 3, 6) // Thursday
		c := full(day(2025, 3, 6), day(2025, 3, 11))
		assertEq(t, weekly(c, today, created), 100, "two partial weeks")
	})

	t.Run("NewHabit_CreatedMidWeek_OnlySecondWeekCompleted", func(t *testing.T) {
		today := day(2025, 3, 12)
		created := day(2025, 3, 6)
		assertEq(t, weekly(full(day(2025, 3, 11)), today, created), 50, "1 of 2 weeks")
	})

	t.Run("SpecExample_6of8_Returns75", func(t *testing.T) {
		// Dynamic like the C#: complete round(totalWeeks*0.75) weeks.
		today := day(2025, 3, 10) // Monday
		windowStart := today.AddDate(0, 0, -59)
		firstMonday := isoWeekStart(civilFromTime(windowStart)).t()
		totalWeeks := 0
		for ws := firstMonday; !ws.After(today); ws = ws.AddDate(0, 0, 7) {
			overlapStart := ws
			if ws.Before(windowStart) {
				overlapStart = windowStart
			}
			overlapEnd := ws.AddDate(0, 0, 6)
			if overlapEnd.After(today) {
				overlapEnd = today
			}
			if !overlapStart.After(overlapEnd) {
				totalWeeks++
			}
		}
		targetWeeks := int(math.Round(float64(totalWeeks) * 0.75))
		var dates []time.Time
		weekCount := 0
		for ws := firstMonday; !ws.After(today); ws = ws.AddDate(0, 0, 7) {
			overlapStart := ws
			if ws.Before(windowStart) {
				overlapStart = windowStart
			}
			overlapEnd := ws.AddDate(0, 0, 6)
			if overlapEnd.After(today) {
				overlapEnd = today
			}
			if !overlapStart.After(overlapEnd) {
				if weekCount < targetWeeks {
					dates = append(dates, overlapStart)
				}
				weekCount++
			}
		}
		want := roundNET(float64(targetWeeks)/float64(totalWeeks)*100, 1)
		assertEq(t, weekly(full(dates...), today, day(2024, 12, 1)), want, "6 of 8 weeks")
	})
}

// oneCompletionPerWeek returns the first in-window day of each ISO week in
// [windowStart, today], matching the loop the C# weekly tests use to seed one
// completion per week.
func oneCompletionPerWeek(windowStart, today time.Time) []time.Time {
	firstMonday := isoWeekStart(civilFromTime(windowStart)).t()
	var out []time.Time
	for ws := firstMonday; !ws.After(today); ws = ws.AddDate(0, 0, 7) {
		for d := ws; !d.After(ws.AddDate(0, 0, 6)); d = d.AddDate(0, 0, 1) {
			if !d.Before(windowStart) && !d.After(today) {
				out = append(out, d)
				break
			}
		}
	}
	return out
}

// --- Custom frequency (ConsistencyCalculatorTests) ---

func TestCustom(t *testing.T) {
	today := day(2025, 3, 1) // Saturday
	oldCreated := day(2024, 12, 1)
	windowStart := today.AddDate(0, 0, -59)

	t.Run("SpecificDays_AllCompleted_Returns100", func(t *testing.T) {
		mwf := []int{int(time.Monday), int(time.Wednesday), int(time.Friday)}
		var dates []time.Time
		for d := windowStart; !d.After(today); d = d.AddDate(0, 0, 1) {
			if containsWeekday(mwf, d.Weekday()) {
				dates = append(dates, d)
			}
		}
		assertEq(t, Calculate(FrequencyCustom, mwf, full(dates...), today, oldCreated), 100, "MWF all done")
	})

	t.Run("NullCustomDays_Returns0", func(t *testing.T) {
		c := full(daysInclusive(windowStart, today)...)
		assertEq(t, Calculate(FrequencyCustom, nil, c, today, oldCreated), 0, "no applicable days")
	})

	t.Run("WeekendsOnly_OnlySaturdays", func(t *testing.T) {
		weekend := []int{int(time.Saturday), int(time.Sunday)}
		weekendDays, saturdays := 0, 0
		var completed []time.Time
		for d := windowStart; !d.After(today); d = d.AddDate(0, 0, 1) {
			if containsWeekday(weekend, d.Weekday()) {
				weekendDays++
				if d.Weekday() == time.Saturday {
					saturdays++
					completed = append(completed, d)
				}
			}
		}
		want := roundNET(float64(saturdays)/float64(weekendDays)*100, 1)
		assertEq(t, Calculate(FrequencyCustom, weekend, full(completed...), today, oldCreated), want, "weekends, only Sat")
	})

	t.Run("SingleDay_MondayOnly_Returns100", func(t *testing.T) {
		mon := []int{int(time.Monday)}
		var dates []time.Time
		for d := windowStart; !d.After(today); d = d.AddDate(0, 0, 1) {
			if d.Weekday() == time.Monday {
				dates = append(dates, d)
			}
		}
		assertEq(t, Calculate(FrequencyCustom, mon, full(dates...), today, oldCreated), 100, "Mondays all done")
	})

	t.Run("HabitCreatedToday_WithCompletion_Returns100", func(t *testing.T) {
		mon := []int{int(time.Monday)}
		mondayToday := day(2025, 3, 3) // Monday
		assertEq(t, Calculate(FrequencyCustom, mon, full(mondayToday), mondayToday, mondayToday), 100, "custom created today")
	})
}

func containsWeekday(days []int, wd time.Weekday) bool {
	for _, d := range days {
		if d == int(wd) {
			return true
		}
	}
	return false
}

// --- Spec examples (ConsistencyCalculatorTests) ---

func TestSpecExamples_Daily(t *testing.T) {
	today := day(2025, 3, 1)
	created := day(2024, 12, 1)
	windowStart := today.AddDate(0, 0, -59)

	t.Run("45of60_Returns75", func(t *testing.T) {
		var dates []time.Time
		count := 0
		for d := windowStart; !d.After(today); d = d.AddDate(0, 0, 1) {
			if count < 45 {
				dates = append(dates, d)
			}
			count++
		}
		assertEq(t, calcDaily(full(dates...), today, created), 75, "45 of 60")
	})

	t.Run("30of60_Returns50", func(t *testing.T) {
		var dates []time.Time
		for d := windowStart; !d.After(today); d = d.AddDate(0, 0, 2) {
			dates = append(dates, d)
		}
		assertEq(t, calcDaily(full(dates...), today, created), 50, "30 of 60")
	})

	t.Run("6of60_Returns10", func(t *testing.T) {
		var dates []time.Time
		for i := 0; i < 6; i++ {
			dates = append(dates, windowStart.AddDate(0, 0, i))
		}
		assertEq(t, calcDaily(full(dates...), today, created), 10, "6 of 60")
	})
}

// --- CalculateForDateRange (CalculateForDateRangeTests) ---

func TestCalculateForDateRange(t *testing.T) {
	created := day(2024, 1, 1) // MakeHabit default
	rangeDaily := func(c []DatedCompletion, start, end, cr time.Time) float64 {
		return CalculateForDateRange(FrequencyDaily, nil, c, start, end, cr)
	}

	t.Run("Daily_AllCompleted_Returns100", func(t *testing.T) {
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		assertEq(t, rangeDaily(full(daysInclusive(start, end)...), start, end, created), 100, "all")
	})

	t.Run("Daily_NoneCompleted_Returns0", func(t *testing.T) {
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		assertEq(t, rangeDaily(nil, start, end, created), 0, "none")
	})

	t.Run("Daily_HalfCompleted_Returns50", func(t *testing.T) {
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		var dates []time.Time
		for d := start; !d.After(end); d = d.AddDate(0, 0, 2) {
			dates = append(dates, d)
		}
		assertEq(t, rangeDaily(full(dates...), start, end, created), 50, "half")
	})

	t.Run("RangeStartAfterEnd_Returns0", func(t *testing.T) {
		assertEq(t, rangeDaily(nil, day(2025, 3, 1), day(2025, 2, 1), created), 0, "reversed")
	})

	t.Run("SingleDayRange_Completed_Returns100", func(t *testing.T) {
		d := day(2025, 2, 10)
		assertEq(t, rangeDaily(full(d), d, d, created), 100, "single done")
	})

	t.Run("SingleDayRange_NotCompleted_Returns0", func(t *testing.T) {
		d := day(2025, 2, 10)
		assertEq(t, rangeDaily(nil, d, d, created), 0, "single not done")
	})

	t.Run("Custom_MWF_OnlyCountsApplicableDays", func(t *testing.T) {
		mwf := []int{int(time.Monday), int(time.Wednesday), int(time.Friday)}
		start, end := day(2025, 2, 3), day(2025, 2, 9)
		c := full(day(2025, 2, 3), day(2025, 2, 5)) // 2 of 3 = 66.7
		assertEq(t, CalculateForDateRange(FrequencyCustom, mwf, c, start, end, created), 66.7, "MWF 2 of 3")
	})

	t.Run("Weekly_TwoWeeksOneCompleted_Returns50", func(t *testing.T) {
		start, end := day(2025, 2, 3), day(2025, 2, 16)
		c := full(day(2025, 2, 5))
		assertEq(t, CalculateForDateRange(FrequencyWeekly, nil, c, start, end, created), 50, "1 of 2 weeks")
	})

	t.Run("CompletionsOutsideRange_AreIgnored", func(t *testing.T) {
		start, end := day(2025, 2, 1), day(2025, 2, 7)
		c := full(day(2025, 1, 31), day(2025, 2, 8), day(2025, 2, 3)) // 1 of 7 = 14.3
		assertEq(t, rangeDaily(c, start, end, created), 14.3, "1 of 7")
	})

	t.Run("Daily_HabitCreatedMidRange_ClampsToCreationDate", func(t *testing.T) {
		cr := day(2025, 2, 8)
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		c := full(daysInclusive(day(2025, 2, 8), end)...) // 7 of 7
		assertEq(t, rangeDaily(c, start, end, cr), 100, "clamp to creation")
	})

	t.Run("Daily_HabitCreatedAfterRangeEnd_Returns0", func(t *testing.T) {
		cr := day(2025, 3, 1)
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		assertEq(t, rangeDaily(full(daysInclusive(start, end)...), start, end, cr), 0, "created after range")
	})

	t.Run("Daily_HabitCreatedMidRange_WithExplicitLocalDate", func(t *testing.T) {
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		c := full(daysInclusive(day(2025, 2, 7), end)...) // 8 of 8
		assertEq(t, rangeDaily(c, start, end, day(2025, 2, 7)), 100, "explicit local created")
	})

	t.Run("SingleDayRange_HabitExisted_Completed", func(t *testing.T) {
		d := day(2025, 2, 10)
		assertEq(t, rangeDaily(full(d), d, d, day(2025, 2, 1)), 100, "existed, done")
	})

	t.Run("SingleDayRange_HabitExisted_NotCompleted", func(t *testing.T) {
		d := day(2025, 2, 10)
		assertEq(t, rangeDaily(nil, d, d, day(2025, 2, 1)), 0, "existed, not done")
	})

	t.Run("SingleDayRange_HabitCreatedThatDay", func(t *testing.T) {
		d := day(2025, 3, 1)
		assertEq(t, rangeDaily(full(d), d, d, day(2025, 3, 1)), 100, "created that day")
	})

	t.Run("SingleDayRange_HabitNotYetCreated", func(t *testing.T) {
		d := day(2025, 3, 1)
		assertEq(t, rangeDaily(full(d), d, d, day(2025, 3, 2)), 0, "not yet created")
	})
}

// --- CalculateForDateRange, timezone overload (CalculateForDateRangeTests) ---

func TestConsistencyForRange_TimezoneOverload(t *testing.T) {
	est, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("loading EST: %v", err)
	}
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatalf("loading Tokyo: %v", err)
	}

	t.Run("ClampsWithTimezoneAwareCreationDate_EST", func(t *testing.T) {
		// Created 2025-02-08 00:00 UTC = 2025-02-07 19:00 EST -> created date Feb 7.
		h := Habit{Frequency: FrequencyDaily, CreatedAt: time.Date(2025, 2, 8, 0, 0, 0, 0, time.UTC)}
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		c := full(daysInclusive(day(2025, 2, 7), end)...) // 8 of 8
		assertEq(t, ConsistencyForRange(h, c, start, end, est), 100, "EST clamps to Feb 7")
	})

	t.Run("PositiveOffset_ClampsCorrectly_Tokyo", func(t *testing.T) {
		// Created 2025-02-07 23:00 UTC = 2025-02-08 08:00 Tokyo -> created date Feb 8.
		h := Habit{Frequency: FrequencyDaily, CreatedAt: time.Date(2025, 2, 7, 23, 0, 0, 0, time.UTC)}
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		c := full(daysInclusive(day(2025, 2, 8), end)...) // 7 of 7
		assertEq(t, ConsistencyForRange(h, c, start, end, tokyo), 100, "Tokyo clamps to Feb 8")
	})

	t.Run("Weekly_HabitCreatedMidRange_ClampsToCreationDate", func(t *testing.T) {
		start, end := day(2025, 2, 3), day(2025, 2, 16)
		c := full(day(2025, 2, 12))
		assertEq(t, CalculateForDateRange(FrequencyWeekly, nil, c, start, end, day(2025, 2, 10)), 100, "1 applicable week")
	})

	t.Run("TimezoneBoundary_CreatedAt11pmEst_RangeStartsMarch1", func(t *testing.T) {
		// 2025-03-02 04:00 UTC = 2025-03-01 23:00 EST.
		h := Habit{Frequency: FrequencyDaily, CreatedAt: time.Date(2025, 3, 2, 4, 0, 0, 0, time.UTC)}
		start, end := day(2025, 3, 1), day(2025, 3, 7)
		c := full(daysInclusive(start, end)...)
		assertEq(t, ConsistencyForRange(h, c, start, end, est), 100, "with tz: 7 days")
		// Without tz the creation date is Mar 2 (UTC), 6 applicable days, all completed.
		assertEq(t, CalculateForDateRange(FrequencyDaily, nil, c, start, end, day(2025, 3, 2)), 100, "without tz: 6 days")
	})

	t.Run("TimezoneBoundary_CreatedAt11pmEst_PartialCompletions", func(t *testing.T) {
		h := Habit{Frequency: FrequencyDaily, CreatedAt: time.Date(2025, 3, 2, 4, 0, 0, 0, time.UTC)}
		start, end := day(2025, 3, 1), day(2025, 3, 7)
		c := full(day(2025, 3, 1)) // only Mar 1
		assertEq(t, ConsistencyForRange(h, c, start, end, est), 14.3, "with tz: 1 of 7")
		assertEq(t, CalculateForDateRange(FrequencyDaily, nil, c, start, end, day(2025, 3, 2)), 0, "without tz: Mar 1 excluded")
	})
}

// --- Weighted CalculateForDateRange (WeightedCalculateForDateRangeTests) ---

func TestWeightedCalculateForDateRange(t *testing.T) {
	created := day(2024, 1, 1)

	t.Run("AllFull_Returns100", func(t *testing.T) {
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		assertEq(t, CalculateForDateRange(FrequencyDaily, nil, full(daysInclusive(start, end)...), start, end, created), 100, "all full")
	})

	t.Run("AllMinimum_Returns50", func(t *testing.T) {
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		c := withKind(CompletionMinimum, daysInclusive(start, end)...)
		assertEq(t, CalculateForDateRange(FrequencyDaily, nil, c, start, end, created), 50, "all minimum")
	})

	t.Run("MixedFullAndMinimum_ProducesWeightedResult", func(t *testing.T) {
		start, end := day(2025, 2, 1), day(2025, 2, 4) // 4 days
		c := []DatedCompletion{
			{LocalDate: day(2025, 2, 1), Kind: CompletionFull},
			{LocalDate: day(2025, 2, 2), Kind: CompletionMinimum},
			{LocalDate: day(2025, 2, 3), Kind: CompletionFull},
		}
		assertEq(t, CalculateForDateRange(FrequencyDaily, nil, c, start, end, created), 62.5, "(1+0.5+1+0)/4")
	})

	t.Run("Weekly_AllMinimum_Returns50", func(t *testing.T) {
		start, end := day(2025, 2, 3), day(2025, 2, 16)
		c := withKind(CompletionMinimum, day(2025, 2, 5), day(2025, 2, 12))
		assertEq(t, CalculateForDateRange(FrequencyWeekly, nil, c, start, end, created), 50, "two weeks, min each")
	})

	t.Run("EmptyDictionary_Returns0", func(t *testing.T) {
		start, end := day(2025, 2, 1), day(2025, 2, 14)
		assertEq(t, CalculateForDateRange(FrequencyDaily, nil, nil, start, end, created), 0, "empty")
	})
}

// --- Weighted rolling window (WeightedConsistencyTests) ---

func TestWeightedConsistency(t *testing.T) {
	t.Run("AllFull_Returns100", func(t *testing.T) {
		today := day(2025, 3, 1)
		c := full(daysInclusive(today.AddDate(0, 0, -59), today)...)
		assertEq(t, calcDaily(c, today, day(2024, 12, 1)), 100, "all full")
	})

	t.Run("AllMinimum_Returns50", func(t *testing.T) {
		today := day(2025, 3, 1)
		c := withKind(CompletionMinimum, daysInclusive(today.AddDate(0, 0, -59), today)...)
		assertEq(t, calcDaily(c, today, day(2024, 12, 1)), 50, "all minimum")
	})

	t.Run("MixedFullAndMinimum_Returns60", func(t *testing.T) {
		today := day(2025, 3, 5)
		created := today.AddDate(0, 0, -4) // 5 applicable days
		c := []DatedCompletion{
			{LocalDate: today.AddDate(0, 0, -4), Kind: CompletionFull},
			{LocalDate: today.AddDate(0, 0, -3), Kind: CompletionMinimum},
			{LocalDate: today.AddDate(0, 0, -2), Kind: CompletionFull},
			{LocalDate: today.AddDate(0, 0, -1), Kind: CompletionMinimum},
		}
		assertEq(t, calcDaily(c, today, created), 60, "(1+0.5+1+0.5+0)/5")
	})

	t.Run("ChangeFromMinimumToFull_IncreasesConsistency", func(t *testing.T) {
		today := day(2025, 3, 5)
		created := today.AddDate(0, 0, -2) // 3 days
		allMin := withKind(CompletionMinimum, today.AddDate(0, 0, -2), today.AddDate(0, 0, -1), today)
		mixed := []DatedCompletion{
			{LocalDate: today.AddDate(0, 0, -2), Kind: CompletionFull},
			{LocalDate: today.AddDate(0, 0, -1), Kind: CompletionMinimum},
			{LocalDate: today, Kind: CompletionMinimum},
		}
		assertEq(t, calcDaily(allMin, today, created), 50, "all min")
		assertEq(t, calcDaily(mixed, today, created), 66.7, "first upgraded to full")
	})

	t.Run("RemoveMinimumCompletion_ReturnsToNone", func(t *testing.T) {
		today := day(2025, 3, 5)
		created := today.AddDate(0, 0, -2) // 3 days
		withMin := withKind(CompletionMinimum, today.AddDate(0, 0, -1))
		assertEq(t, calcDaily(withMin, today, created), 16.7, "0.5/3")
		assertEq(t, calcDaily(nil, today, created), 0, "removed")
	})

	t.Run("MixedHistory_FullMinimumMiss_Returns50", func(t *testing.T) {
		today := day(2025, 3, 1)
		windowStart := today.AddDate(0, 0, -59)
		var c []DatedCompletion
		dayCount := 0
		for d := windowStart; !d.After(today); d = d.AddDate(0, 0, 1) {
			switch {
			case dayCount < 20:
				c = append(c, DatedCompletion{LocalDate: d, Kind: CompletionFull})
			case dayCount < 40:
				c = append(c, DatedCompletion{LocalDate: d, Kind: CompletionMinimum})
			}
			dayCount++
		}
		assertEq(t, calcDaily(c, today, day(2024, 12, 1)), 50, "(20+10+0)/60")
	})

	t.Run("Weekly_AllWeeksWithFull_Returns100", func(t *testing.T) {
		today := day(2025, 3, 10)
		dates := oneCompletionPerWeek(today.AddDate(0, 0, -59), today)
		assertEq(t, Calculate(FrequencyWeekly, nil, full(dates...), today, day(2024, 12, 1)), 100, "full each week")
	})

	t.Run("Weekly_AllWeeksWithMinimumOnly_Returns50", func(t *testing.T) {
		today := day(2025, 3, 10)
		dates := oneCompletionPerWeek(today.AddDate(0, 0, -59), today)
		c := withKind(CompletionMinimum, dates...)
		assertEq(t, Calculate(FrequencyWeekly, nil, c, today, day(2024, 12, 1)), 50, "min each week")
	})

	t.Run("Weekly_MixedFullAndMinimumInSameWeek_UsesBest", func(t *testing.T) {
		today := day(2025, 3, 16)  // Sunday
		created := day(2025, 3, 3) // Monday
		minOnly := withKind(CompletionMinimum, day(2025, 3, 3), day(2025, 3, 10))
		mixed := []DatedCompletion{
			{LocalDate: day(2025, 3, 3), Kind: CompletionMinimum},
			{LocalDate: day(2025, 3, 4), Kind: CompletionFull},
			{LocalDate: day(2025, 3, 10), Kind: CompletionMinimum},
		}
		assertEq(t, Calculate(FrequencyWeekly, nil, minOnly, today, created), 50, "both weeks min")
		assertEq(t, Calculate(FrequencyWeekly, nil, mixed, today, created), 75, "week1 best=full")
	})

	t.Run("Custom_MWF_AllMinimum_Returns50", func(t *testing.T) {
		today := day(2025, 3, 1)
		mwf := []int{int(time.Monday), int(time.Wednesday), int(time.Friday)}
		var c []DatedCompletion
		for d := today.AddDate(0, 0, -59); !d.After(today); d = d.AddDate(0, 0, 1) {
			if containsWeekday(mwf, d.Weekday()) {
				c = append(c, DatedCompletion{LocalDate: d, Kind: CompletionMinimum})
			}
		}
		assertEq(t, Calculate(FrequencyCustom, mwf, c, today, day(2024, 12, 1)), 50, "MWF all min")
	})

	t.Run("EmptyDictionary_Returns0", func(t *testing.T) {
		today := day(2025, 3, 1)
		assertEq(t, calcDaily(nil, today, day(2024, 12, 1)), 0, "empty")
	})
}

// --- GetWeight (WeightedConsistencyTests) ---

func TestGetWeight(t *testing.T) {
	cases := []struct {
		kind CompletionKind
		want float64
	}{
		{CompletionFull, 1.0},
		{CompletionMinimum, 0.5},
		{CompletionNone, 0},
	}
	for _, c := range cases {
		if got := GetWeight(c.kind); got != c.want {
			t.Errorf("GetWeight(%v) = %v, want %v", c.kind, got, c.want)
		}
	}
}

// --- Flame levels (FlameLevelTests) ---

func TestGetFlameLevel_RisingThresholds(t *testing.T) {
	cases := []struct {
		consistency float64
		want        FlameLevel
	}{
		{0, FlameNone}, {5, FlameNone}, {9.9, FlameNone},
		{10, FlameEmber}, {20, FlameEmber}, {29.9, FlameEmber},
		{30, FlameSteady}, {45, FlameSteady}, {54.9, FlameSteady},
		{55, FlameStrong}, {70, FlameStrong}, {79.9, FlameStrong},
		{80, FlameBlazing}, {90, FlameBlazing}, {100, FlameBlazing},
	}
	for _, c := range cases {
		if got := GetFlameLevel(c.consistency, nil); got != c.want {
			t.Errorf("GetFlameLevel(%v, nil) = %v, want %v", c.consistency, got, c.want)
		}
	}
}

func TestGetFlameLevel_Hysteresis(t *testing.T) {
	lvl := func(l FlameLevel) *FlameLevel { return &l }
	cases := []struct {
		name        string
		consistency float64
		previous    *FlameLevel
		want        FlameLevel
	}{
		// Grows quickly: improvement reflected immediately.
		{"grow none->ember", 10, lvl(FlameNone), FlameEmber},
		{"grow ember->steady", 30, lvl(FlameEmber), FlameSteady},
		{"grow steady->strong", 55, lvl(FlameSteady), FlameStrong},
		{"grow strong->blazing", 80, lvl(FlameStrong), FlameBlazing},
		// Shrinks slowly: holds until the falling threshold.
		{"hold blazing at 65", 65, lvl(FlameBlazing), FlameBlazing},
		{"blazing drops to strong at 64", 64, lvl(FlameBlazing), FlameStrong},
		{"hold strong at 40", 40, lvl(FlameStrong), FlameStrong},
		{"strong drops to steady at 39", 39, lvl(FlameStrong), FlameSteady},
		{"hold steady at 20", 20, lvl(FlameSteady), FlameSteady},
		{"steady drops to ember at 19", 19, lvl(FlameSteady), FlameEmber},
		{"hold ember at 5", 5, lvl(FlameEmber), FlameEmber},
		{"ember drops to none at 4", 4, lvl(FlameEmber), FlameNone},
		// Multi-level drops (one step at a time, but falling ladder can skip).
		{"blazing to ember at 5", 5, lvl(FlameBlazing), FlameEmber},
		{"blazing to none at 0", 0, lvl(FlameBlazing), FlameNone},
		// Same band, no change.
		{"same strong at 60", 60, lvl(FlameStrong), FlameStrong},
		// Extremes without previous.
		{"extreme 0", 0, nil, FlameNone},
		{"extreme 100", 100, nil, FlameBlazing},
	}
	for _, c := range cases {
		if got := GetFlameLevel(c.consistency, c.previous); got != c.want {
			t.Errorf("%s: GetFlameLevel(%v, %v) = %v, want %v", c.name, c.consistency, c.previous, got, c.want)
		}
	}
}

func TestFlameLevel_String(t *testing.T) {
	cases := map[FlameLevel]string{
		FlameNone: "none", FlameEmber: "ember", FlameSteady: "steady",
		FlameStrong: "strong", FlameBlazing: "blazing",
	}
	for lvl, want := range cases {
		if got := lvl.String(); got != want {
			t.Errorf("FlameLevel(%d).String() = %q, want %q", lvl, got, want)
		}
	}
}

// --- Share-surface UTC parity (ShareSurfaceTimezoneParityTests) ---

func TestShareSurfaceUtcParity(t *testing.T) {
	created := day(2024, 12, 1)

	t.Run("MidnightBoundary_ViewerTimezoneWouldDiverge_ButUtcDoesNot", func(t *testing.T) {
		c := full(daysInclusive(day(2024, 12, 1), day(2025, 1, 31))...)
		utcToday := day(2025, 1, 31)
		tokyoToday := day(2025, 2, 1)
		utc := calcDaily(c, utcToday, created)
		tokyo := calcDaily(c, tokyoToday, created)
		if utc == tokyo {
			t.Errorf("expected UTC (%v) and Tokyo (%v) to diverge at the boundary", utc, tokyo)
		}
		// All share surfaces use UTC, so they agree.
		s1 := calcDaily(c, utcToday, created)
		s2 := calcDaily(c, utcToday, created)
		s3 := calcDaily(c, utcToday, created)
		if s1 != s2 || s2 != s3 {
			t.Errorf("UTC surfaces disagree: %v, %v, %v", s1, s2, s3)
		}
	})

	t.Run("MidnightBoundary_FlameLevelConsistentAcrossSurfaces", func(t *testing.T) {
		utcToday := day(2025, 1, 31)
		windowStart := utcToday.AddDate(0, 0, -59)
		var c []DatedCompletion
		count := 0
		for d := windowStart; !d.After(utcToday) && count < 17; d = d.AddDate(0, 0, 1) {
			c = append(c, DatedCompletion{LocalDate: d, Kind: CompletionFull})
			count++
		}
		consistency := calcDaily(c, utcToday, created)
		if consistency >= 30 {
			t.Errorf("expected < 30 for boundary test, got %v", consistency)
		}
		if got := GetFlameLevel(consistency, nil); got != FlameEmber {
			t.Errorf("flame = %v, want Ember", got)
		}
	})
}

// --- Additional AC coverage ---

// TestRoundNET_MatchesDotNet is the explicit banker's-rounding regression the
// bead requires. Every "want" was captured from a live .NET 10 run of
// Math.Round(x, 1) (see the bead report's rounding section); each x.x5 case is
// a genuine midpoint that Go's default half-away-from-zero rounding would get
// wrong.
func TestRoundNET_MatchesDotNet(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{0.5 / 8 * 100, 6.2}, // one minimum over 8 applicable days
		{6.25, 6.2},
		{0.15, 0.2}, // *10 rounds back up to 1.5 on both stacks -> 0.2
		{1.0 / 3 * 100, 33.3},
		{2.0 / 3 * 100, 66.7},
		{37.35, 37.4},
		{37.45, 37.4},
		{62.55, 62.6},
		{0.5 / 40 * 100, 1.2},
		{1.5 / 40 * 100, 3.8},
		{2.5 / 40 * 100, 6.2},
		{14.25, 14.2},
		{14.35, 14.4},
		{0.05, 0.0},
		{0.25, 0.2},
		{0.35, 0.4},
		{0.45, 0.4},
		{0.55, 0.6},
		{0.65, 0.6},
		{0.75, 0.8},
		{0.85, 0.8},
		{0.95, 1.0},
		{1.05, 1.0},
		{33.25, 33.2},
		{33.35, 33.4},
	}
	for _, c := range cases {
		if got := roundNET(c.in, 1); got != c.want {
			t.Errorf("roundNET(%.17g, 1) = %v, want %v (.NET Math.Round)", c.in, got, c.want)
		}
	}
}

// TestConsistency_RoundingMidpoint_BankersNotAwayFromZero proves the banker's
// rule flows through the actual calculator: one Minimum over 8 daily
// applicable days is 0.5/8*100 = 6.25, which .NET rounds to 6.2 (2 is even),
// NOT 6.3. A naive half-away-from-zero implementation would return 6.3 and
// diverge from the old stack.
func TestConsistency_RoundingMidpoint_BankersNotAwayFromZero(t *testing.T) {
	today := day(2025, 3, 8)
	created := today.AddDate(0, 0, -7) // 8 applicable days
	c := withKind(CompletionMinimum, created)
	assertEq(t, calcDaily(c, today, created), 6.2, "6.25 -> 6.2 (banker's)")
}

// TestConsistency_BackfillWeightedBeforeCreation verifies the a35bd06 backfill
// rule carries weights: a single Minimum backfilled two days before creation
// scores from that date. Window = [created-2 .. today] = 3 days, weight 0.5 ->
// 0.5/3*100 = 16.7.
func TestConsistency_BackfillWeightedBeforeCreation(t *testing.T) {
	today := day(2025, 3, 3)
	created := today
	c := withKind(CompletionMinimum, today.AddDate(0, 0, -2))
	assertEq(t, calcDaily(c, today, created), 16.7, "0.5/3 from backfilled minimum")
}

// TestConsistency_DST_DayCountUnaffected proves date arithmetic never loses or
// gains a day across a DST transition — the engine works in civil-date space
// (UTC-midnight internally), so a range spanning US spring-forward
// (2025-03-09) or fall-back (2025-11-02) still has exactly the calendar number
// of applicable days.
func TestConsistency_DST_DayCountUnaffected(t *testing.T) {
	// Spring forward: Mar 7..Mar 11 is 5 calendar days regardless of the
	// 23-hour day on Mar 9. All completed -> 100 (denominator 5, not 4 or 6).
	springStart, springEnd := day(2025, 3, 7), day(2025, 3, 11)
	spring := full(daysInclusive(springStart, springEnd)...)
	assertEq(t, CalculateForDateRange(FrequencyDaily, nil, spring, springStart, springEnd, day(2025, 1, 1)), 100, "spring-forward span")

	// One miss out of the 5 -> 4/5 = 80, proving the denominator is exactly 5.
	springPartial := full(day(2025, 3, 7), day(2025, 3, 8), day(2025, 3, 10), day(2025, 3, 11))
	assertEq(t, CalculateForDateRange(FrequencyDaily, nil, springPartial, springStart, springEnd, day(2025, 1, 1)), 80, "4 of 5 across DST")

	// Fall back: Oct 31..Nov 3 is 4 calendar days regardless of the 25-hour
	// day on Nov 2.
	fallStart, fallEnd := day(2025, 10, 31), day(2025, 11, 3)
	fall := full(daysInclusive(fallStart, fallEnd)...)
	assertEq(t, CalculateForDateRange(FrequencyDaily, nil, fall, fallStart, fallEnd, day(2025, 1, 1)), 100, "fall-back span")
}

// TestConsistency_DateLineTimezone_ChangesCreationDate proves a single
// creation instant resolves to different civil dates on opposite sides of the
// date line, changing the clamp. 2025-03-02 06:00 UTC is Mar 2 in Kiritimati
// (UTC+14) but Mar 1 in Pago_Pago (UTC-11); with only Mar 1 completed over the
// range Mar 1..Mar 3, Kiritimati clamps Mar 1 out (0 of applicable) while
// Pago_Pago keeps it.
func TestConsistency_DateLineTimezone_ChangesCreationDate(t *testing.T) {
	kiritimati, err := time.LoadLocation("Pacific/Kiritimati") // UTC+14
	if err != nil {
		t.Fatalf("loading Kiritimati: %v", err)
	}
	pago, err := time.LoadLocation("Pacific/Pago_Pago") // UTC-11
	if err != nil {
		t.Fatalf("loading Pago_Pago: %v", err)
	}
	h := Habit{Frequency: FrequencyDaily, CreatedAt: time.Date(2025, 3, 2, 6, 0, 0, 0, time.UTC)}
	start, end := day(2025, 3, 1), day(2025, 3, 3)
	c := full(day(2025, 3, 1))

	// Kiritimati: created Mar 2, range clamps to Mar 2..Mar 3 (2 days), Mar 1
	// completion is before the clamp -> 0.
	assertEq(t, ConsistencyForRange(h, c, start, end, kiritimati), 0, "Kiritimati clamps Mar 1 out")
	// Pago_Pago: created Mar 1, range Mar 1..Mar 3 (3 days), 1 completed -> 33.3.
	assertEq(t, ConsistencyForRange(h, c, start, end, pago), 33.3, "Pago_Pago keeps Mar 1")
}

// TestConsistency_CompletionAheadOfToday_KiritimatiDateLine root-causes and
// pins the UTC+14 (Pacific/Kiritimati) edge case flagged during parity review.
//
// When a far-east owner (UTC+14) completes a habit for THEIR local "today",
// the completion's LocalDate is one calendar day AHEAD of the same instant's
// UTC date. Both the backfill window scan (date >= windowStart && date <=
// today) and the day-iteration loop (date <= today) exclude any completion
// dated after "today". So:
//   - In the UTC share view (today one day behind), the completion is
//     future-dated: it contributes 0 to consistency, is not "completedToday",
//     and is not counted in-window — even though it still appears in the
//     unfiltered completedDates list (see stats handler).
//   - In the owner's own tz view (today == that date), it counts fully.
//
// This is the INTENDED per-surface timezone contract (a share surface can be a
// UTC-day behind a date-line owner), not a bug. Verified byte-identical live
// against the old .NET stack (owner=100/UTC=0). The only mild oddity — the UTC
// view still LISTING a future/out-of-window date in completedDates — matches
// the C# and is a candidate cosmetic post-cutover cleanup, not a parity fix.
func TestConsistency_CompletionAheadOfToday_KiritimatiDateLine(t *testing.T) {
	// D = the UTC calendar date; the owner's Kiritimati "today" is D+1, and the
	// completion is logged on D+1. The habit is created "now": that instant is
	// D in UTC and D+1 in Kiritimati.
	utcToday := day(2026, 7, 9)
	ahead := day(2026, 7, 10) // owner's Kiritimati "today", one day ahead of UTC
	completion := full(ahead)

	// UTC share view: today = D, created resolves to D. The D+1 completion is
	// future-dated and excluded -> 0.
	assertEq(t, calcDaily(completion, utcToday, utcToday), 0, "UTC view excludes the day-ahead completion")

	// Owner (Kiritimati) view: today = D+1, created resolves to D+1. The
	// completion is on today -> counts fully.
	assertEq(t, calcDaily(completion, ahead, ahead), 100, "owner view counts its own today")

	// Even an old habit (created well before the window) gives 0 in the UTC
	// view: the single completion is still after today, so no applicable day in
	// [effectiveStart, today] is completed.
	assertEq(t, calcDaily(completion, utcToday, day(2026, 1, 1)), 0, "old habit, UTC view still 0")
}

// TestConsistency_WeeklyBestKind_FullShortCircuits confirms a week containing a
// Full plus a None-weight day still scores 1.0 (Full is the best kind and
// short-circuits), and a week with only a Minimum scores 0.5.
func TestConsistency_WeeklyBestKind_FullShortCircuits(t *testing.T) {
	today := day(2025, 3, 16)  // Sunday, end of week 2
	created := day(2025, 3, 3) // Monday, start of week 1
	c := []DatedCompletion{
		{LocalDate: day(2025, 3, 3), Kind: CompletionMinimum},
		{LocalDate: day(2025, 3, 5), Kind: CompletionFull}, // best in week 1
		{LocalDate: day(2025, 3, 6), Kind: CompletionNone}, // ignored (weight 0)
		{LocalDate: day(2025, 3, 12), Kind: CompletionMinimum},
	}
	// Week 1 best = 1.0, week 2 best = 0.5 -> (1.0 + 0.5) / 2 = 75.
	assertEq(t, Calculate(FrequencyWeekly, nil, c, today, created), 75, "full short-circuits week 1")
}
