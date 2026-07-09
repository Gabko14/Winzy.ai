package habits

import (
	"math"
	"time"
)

// This file is an EXACT port of
// services/habit-service/src/Services/ConsistencyCalculator.cs — the Flame,
// which is the product. Every constant, boundary, rounding decision, and
// branch is deliberately kept identical to the C# source; parity is verified
// by consistency_test.go (which ports every C# calculator test with its exact
// expected values) and by the live cross-stack golden check in the bead
// report (winzy.ai-rdc7.3.2). Do not "clean up" the asymmetric hysteresis, the
// backfill scoreStart rule, or the round-half-to-even scaling below without
// re-running both — a one-tenth divergence is a user-visible product bug.

// Window and weight constants mirror ConsistencyCalculator's consts exactly.
const (
	// WindowDays is the rolling-window size: consistency is scored over
	// [today-59 .. today], 60 days inclusive of today.
	WindowDays = 60
	// FullWeight and MinimumWeight are the Honest Minimums weights: a Full
	// completion counts 1.0, a Minimum counts 0.5, a miss 0.
	FullWeight    = 1.0
	MinimumWeight = 0.5
)

// FlameLevel is the visual flame intensity a consistency percentage maps to,
// mirroring the C# FlameLevel enum (None=0 .. Blazing=4). The wire form is the
// lowercase name (see String), matching frontend/src/api/habits.ts's FlameLevel
// string union and habit-service's `.ToString().ToLowerInvariant()`.
type FlameLevel int

const (
	FlameNone    FlameLevel = 0
	FlameEmber   FlameLevel = 1
	FlameSteady  FlameLevel = 2
	FlameStrong  FlameLevel = 3
	FlameBlazing FlameLevel = 4
)

// String renders the lowercase wire/response form.
func (l FlameLevel) String() string {
	switch l {
	case FlameEmber:
		return "ember"
	case FlameSteady:
		return "steady"
	case FlameStrong:
		return "strong"
	case FlameBlazing:
		return "blazing"
	default:
		return "none"
	}
}

// DatedCompletion is one scored completion: its local (civil) date and kind.
// Only the Year/Month/Day of LocalDate are read — any clock/zone it carries is
// ignored — so it matches .NET's DateOnly-keyed dictionary regardless of how
// the date was constructed (a UTC-midnight time from pgx, or a builder in a
// test). It is the calculator's input shape so the same pure functions serve
// both the stats endpoint here and challenges' CustomDateRange milestones in
// winzy.ai-rdc7.5.
type DatedCompletion struct {
	LocalDate time.Time
	Kind      CompletionKind
}

// civilDate is a timezone-free calendar date — the Go analogue of .NET's
// DateOnly. The engine works entirely in civilDate space so date arithmetic
// (window bounds, ISO week starts, applicable-day checks, map keys) can never
// be perturbed by a time-of-day or a *time.Location, and so a civilDate is a
// safe, comparable map key (unlike time.Time). Every operation mirrors the
// DateOnly method the C# calls at the same spot.
type civilDate struct {
	year  int
	month time.Month
	day   int
}

func civilOf(year int, month time.Month, day int) civilDate {
	return civilDate{year: year, month: month, day: day}
}

// civilFromTime reads only the Y/M/D of t, in t's own location — so
// civilFromTime(time.Now().In(loc)) is the local calendar date in loc, and
// civilFromTime(utcMidnight) is the stored date, exactly like
// DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(..., tz)).
func civilFromTime(t time.Time) civilDate {
	return civilDate{year: t.Year(), month: t.Month(), day: t.Day()}
}

func (c civilDate) t() time.Time {
	return time.Date(c.year, c.month, c.day, 0, 0, 0, 0, time.UTC)
}

func (c civilDate) addDays(n int) civilDate {
	return civilFromTime(c.t().AddDate(0, 0, n))
}

func (c civilDate) weekday() time.Weekday { return c.t().Weekday() }

// compare returns -1, 0, +1 like DateOnly's comparison operators.
func (c civilDate) compare(o civilDate) int { return c.t().Compare(o.t()) }
func (c civilDate) before(o civilDate) bool { return c.compare(o) < 0 }
func (c civilDate) after(o civilDate) bool  { return c.compare(o) > 0 }

// minCivil / maxCivil mirror the C#'s `a < b ? a : b` ternaries used to derive
// scoreStart and effectiveStart.
func minCivil(a, b civilDate) civilDate {
	if a.before(b) {
		return a
	}
	return b
}

func maxCivil(a, b civilDate) civilDate {
	if a.after(b) {
		return a
	}
	return b
}

// GetWeight returns the weight for a completion kind — Full=1.0, Minimum=0.5,
// None/anything-else=0 — matching ConsistencyCalculator.GetWeight.
func GetWeight(kind CompletionKind) float64 {
	switch kind {
	case CompletionFull:
		return FullWeight
	case CompletionMinimum:
		return MinimumWeight
	default:
		return 0
	}
}

// Calculate returns the weighted consistency percentage (0-100, rounded to one
// decimal) for a habit over the 60-day rolling window, an exact port of
// ConsistencyCalculator.Calculate(habit, completions, today, habitCreatedLocalDate).
// today and habitCreated are read as civil dates (Y/M/D only); callers that
// need timezone resolution do it before calling (see Consistency in
// service.go, mirroring the C# TimeZoneInfo overload).
func Calculate(freq Frequency, customDays []int, completions []DatedCompletion, today, habitCreated time.Time) float64 {
	return calcConsistency(freq, customDays, completionMap(completions), civilFromTime(today), civilFromTime(habitCreated))
}

// Consistency computes a habit's weighted consistency over the 60-day rolling
// window with "today" and the habit's creation date both resolved in loc — the
// timezone-aware entry point owner surfaces use (GET /habits/{id}/stats,
// completion recompute), mirroring the C# Calculate(habit, completions,
// TimeZoneInfo) overload. Share surfaces (public flame, flame.svg — built in
// winzy.ai-rdc7.3.3) pass time.UTC as loc per the hardcoded-UTC contract.
func Consistency(h Habit, completions []DatedCompletion, loc *time.Location) float64 {
	today := time.Now().In(loc)
	created := h.CreatedAt.In(loc)
	return Calculate(h.Frequency, h.CustomDays, completions, today, created)
}

// CalculateForDateRange returns weighted consistency over an arbitrary
// [rangeStart, rangeEnd] range clamped to the habit's creation date — the
// engine challenges' CustomDateRange milestones consume (winzy.ai-rdc7.5). It
// is an exact port of ConsistencyCalculator.CalculateForDateRange(habit,
// completions, rangeStart, rangeEnd, habitCreatedLocalDate).
func CalculateForDateRange(freq Frequency, customDays []int, completions []DatedCompletion, rangeStart, rangeEnd, habitCreated time.Time) float64 {
	return calcForRange(freq, customDays, completionMap(completions), civilFromTime(rangeStart), civilFromTime(rangeEnd), civilFromTime(habitCreated))
}

// ConsistencyForRange computes weighted consistency over [rangeStart,
// rangeEnd] with the habit's creation date resolved in loc — the timezone-aware
// range overload, mirroring the C# CalculateForDateRange(habit, completions,
// rangeStart, rangeEnd, TimeZoneInfo). Challenges (winzy.ai-rdc7.5) consume
// this for CustomDateRange milestones, resolving created in the challenge's
// ?tz (falling back to UTC). rangeStart/rangeEnd are read as civil dates.
func ConsistencyForRange(h Habit, completions []DatedCompletion, rangeStart, rangeEnd time.Time, loc *time.Location) float64 {
	created := h.CreatedAt.In(loc)
	return CalculateForDateRange(h.Frequency, h.CustomDays, completions, rangeStart, rangeEnd, created)
}

func completionMap(cs []DatedCompletion) map[civilDate]CompletionKind {
	m := make(map[civilDate]CompletionKind, len(cs))
	for _, c := range cs {
		m[civilFromTime(c.LocalDate)] = c.Kind
	}
	return m
}

// calcConsistency is the civilDate core of Calculate — kept separate so
// consistency_test.go can drive it with explicit dates, exactly as the C#
// tests drive the explicit-today overload.
func calcConsistency(freq Frequency, customDays []int, completions map[civilDate]CompletionKind, today, habitCreated civilDate) float64 {
	windowStart := today.addDays(-(WindowDays - 1))

	// BACKFILL RULE (C# a35bd06): if the earliest completion inside the window
	// predates the habit's creation date, score from it so backfilled
	// completions the calendar shows still count toward the flame. Otherwise
	// score from creation. Then clamp the start into the window.
	firstCompletionInWindow := habitCreated
	seen := false
	for date := range completions {
		if date.before(windowStart) || date.after(today) {
			continue
		}
		if !seen || date.before(firstCompletionInWindow) {
			firstCompletionInWindow = date
			seen = true
		}
	}
	scoreStart := minCivil(firstCompletionInWindow, habitCreated)
	effectiveStart := maxCivil(windowStart, scoreStart)

	if effectiveStart.after(today) {
		return 0
	}

	if freq == FrequencyWeekly {
		return calcWeekly(effectiveStart, today, completions)
	}
	return calcDailyOrCustom(freq, customDays, effectiveStart, today, completions)
}

// calcForRange ports CalculateForDateRange's civilDate core.
func calcForRange(freq Frequency, customDays []int, completions map[civilDate]CompletionKind, rangeStart, rangeEnd, habitCreated civilDate) float64 {
	if rangeStart.after(rangeEnd) {
		return 0
	}
	effectiveStart := maxCivil(rangeStart, habitCreated)
	if effectiveStart.after(rangeEnd) {
		return 0
	}
	if freq == FrequencyWeekly {
		return calcWeekly(effectiveStart, rangeEnd, completions)
	}
	return calcDailyOrCustom(freq, customDays, effectiveStart, rangeEnd, completions)
}

// calcDailyOrCustom sums completion weights over applicable days in
// [effectiveStart, end] and divides by the applicable-day count, matching the
// Daily/Custom branch shared by both C# overloads.
func calcDailyOrCustom(freq Frequency, customDays []int, effectiveStart, end civilDate, completions map[civilDate]CompletionKind) float64 {
	applicableDays := 0
	weightedSum := 0.0
	for date := effectiveStart; !date.after(end); date = date.addDays(1) {
		if !isApplicableDay(freq, customDays, date) {
			continue
		}
		applicableDays++
		if kind, ok := completions[date]; ok {
			weightedSum += GetWeight(kind)
		}
	}
	if applicableDays == 0 {
		return 0
	}
	return roundNET(weightedSum/float64(applicableDays)*100, 1)
}

// calcWeekly ports CalculateWeeklyWeighted: each ISO week (Monday start)
// overlapping [effectiveStart, end] counts once, weighted by the best
// completion kind found in the week's overlap (Full short-circuits).
func calcWeekly(effectiveStart, end civilDate, completions map[civilDate]CompletionKind) float64 {
	totalWeeks := 0
	weightedSum := 0.0

	weekStart := isoWeekStart(effectiveStart)
	for !weekStart.after(end) {
		weekEnd := weekStart.addDays(6)
		overlapStart := maxCivil(weekStart, effectiveStart)
		overlapEnd := minCivil(weekEnd, end)

		if !overlapStart.after(overlapEnd) {
			totalWeeks++
			bestWeight := 0.0
			for d := overlapStart; !d.after(overlapEnd); d = d.addDays(1) {
				if kind, ok := completions[d]; ok {
					w := GetWeight(kind)
					if w > bestWeight {
						bestWeight = w
					}
					if bestWeight >= FullWeight {
						break // can't do better than full
					}
				}
			}
			weightedSum += bestWeight
		}
		weekStart = weekStart.addDays(7)
	}

	if totalWeeks == 0 {
		return 0
	}
	return roundNET(weightedSum/float64(totalWeeks)*100, 1)
}

// isoWeekStart returns the Monday of the ISO week containing date, matching
// GetIsoWeekStart: dayOfWeek = ((int)DayOfWeek + 6) % 7 with Monday=0.
// Go's time.Weekday and .NET's DayOfWeek both number Sunday=0..Saturday=6, so
// the arithmetic is identical.
func isoWeekStart(date civilDate) civilDate {
	dayOfWeek := (int(date.weekday()) + 6) % 7
	return date.addDays(-dayOfWeek)
}

// isApplicableDay reports whether date counts for this habit's frequency:
// Daily=every day, Custom=only weekdays in customDays, Weekly handled
// separately. Mirrors IsApplicableDay; custom_days stores weekday integers
// with Sunday=0 (the .NET DayOfWeek / Go time.Weekday numbering), so the
// membership check is a direct match.
func isApplicableDay(freq Frequency, customDays []int, date civilDate) bool {
	switch freq {
	case FrequencyDaily:
		return true
	case FrequencyCustom:
		wd := int(date.weekday())
		for _, d := range customDays {
			if d == wd {
				return true
			}
		}
		return false
	default:
		return false
	}
}

// GetFlameLevel maps a consistency percentage to a FlameLevel with the C#'s
// asymmetric hysteresis ("grows quickly, shrinks slowly"), an exact port of
// ConsistencyCalculator.GetFlameLevel. previous is nil at every current call
// site (nothing persists a prior level), so the falling branch is dormant —
// but it is ported for parity and covered by tests.
func GetFlameLevel(consistency float64, previous *FlameLevel) FlameLevel {
	rising := risingLevel(consistency)
	if previous == nil || rising >= *previous {
		return rising
	}
	falling := fallingLevel(consistency)
	if falling > *previous {
		return *previous
	}
	return falling
}

// risingLevel is the "grows quickly" threshold ladder (>=10 Ember, >=30 Steady,
// >=55 Strong, >=80 Blazing).
func risingLevel(consistency float64) FlameLevel {
	switch {
	case consistency >= 80:
		return FlameBlazing
	case consistency >= 55:
		return FlameStrong
	case consistency >= 30:
		return FlameSteady
	case consistency >= 10:
		return FlameEmber
	default:
		return FlameNone
	}
}

// fallingLevel is the "shrinks slowly" threshold ladder (>=5 Ember, >=20 Steady,
// >=40 Strong, >=65 Blazing), applied only when declining below previous.
func fallingLevel(consistency float64) FlameLevel {
	switch {
	case consistency >= 65:
		return FlameBlazing
	case consistency >= 40:
		return FlameStrong
	case consistency >= 20:
		return FlameSteady
	case consistency >= 5:
		return FlameEmber
	default:
		return FlameNone
	}
}

// roundPower10 mirrors .NET's roundPower10Double table of exact powers of ten.
var roundPower10 = [...]float64{
	1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7,
	1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15,
}

// doubleRoundLimit mirrors .NET's constant: values at or beyond 1e16 are
// returned unchanged (they carry no fractional part a double can round).
const doubleRoundLimit = 1e16

// roundNET replicates System.Math.Round(value, digits) with its default
// MidpointRounding.ToEven — banker's rounding — bit-for-bit. .NET scales by an
// exact power of ten, rounds the scaled double to the nearest integer with
// ties-to-even, then unscales; Go's math.RoundToEven is the identical IEEE-754
// roundTiesToEven, and IEEE multiply/divide are deterministic, so the two
// stacks produce identical results. This is NOT the same as Go's default
// math.Round (half away from zero) or an fmt "%.1f" shortcut — using either
// would diverge from C# at x.x5 midpoints (e.g. 6.25 -> 6.2 here, not 6.3).
// Verified empirically against .NET 10 and covered by consistency_test.go's
// rounding table.
func roundNET(value float64, digits int) float64 {
	if math.Abs(value) >= doubleRoundLimit {
		return value
	}
	power10 := roundPower10[digits]
	value *= power10
	value = math.RoundToEven(value)
	value /= power10
	return value
}
