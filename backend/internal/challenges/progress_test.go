package challenges

import (
	"math"
	"testing"
	"time"
)

func makeChallenge(milestone MilestoneType, target float64, completionCount int, baseline *float64) Challenge {
	return Challenge{
		MilestoneType:       milestone,
		TargetValue:         target,
		PeriodDays:          30,
		CompletionCount:     completionCount,
		BaselineConsistency: baseline,
		RewardDescription:   "Test reward",
		Status:              StatusActive,
	}
}

func ctxConsistency(c float64) MilestoneContext {
	return MilestoneContext{Consistency: c}
}

func TestCalculateProgress_ConsistencyTarget(t *testing.T) {
	cases := []struct {
		name        string
		target, cur float64
		want        float64
	}{
		{"zero consistency", 80, 0, 0},
		{"halfway", 80, 40, 0.5},
		{"at target", 80, 80, 1},
		{"above clamped", 80, 100, 1},
		{"zero target", 0, 50, 1},
		{"negative clamped", 80, -10, 0},
		{"precision 20/80", 80, 20, 0.25},
		{"precision 60/80", 80, 60, 0.75},
		{"precision 33/100", 100, 33, 0.33},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := CalculateProgress(makeChallenge(MilestoneConsistencyTarget, tc.target, 0, nil), ctxConsistency(tc.cur))
			if math.Abs(got-tc.want) > 1e-9 {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestIsMilestoneReached_ConsistencyTarget(t *testing.T) {
	cases := []struct {
		target, cur float64
		want        bool
	}{
		{80, 79.9, false},
		{80, 80, true},
		{80, 100, true},
		{50, 50, true},
		{50, 49.99, false},
		{1, 0.9, false},
		{1, 1, true},
	}
	for _, tc := range cases {
		got := IsMilestoneReached(makeChallenge(MilestoneConsistencyTarget, tc.target, 0, nil), ctxConsistency(tc.cur))
		if got != tc.want {
			t.Fatalf("target=%v cur=%v: got %v, want %v", tc.target, tc.cur, got, tc.want)
		}
	}
}

func TestCalculateProgress_DaysInPeriod(t *testing.T) {
	cases := []struct {
		name  string
		count int
		want  float64
	}{
		{"none", 0, 0},
		{"halfway", 10, 0.5},
		{"all", 20, 1},
		{"over", 25, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := CalculateProgress(makeChallenge(MilestoneDaysInPeriod, 20, tc.count, nil), ctxConsistency(0))
			if got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
	got := CalculateProgress(makeChallenge(MilestoneDaysInPeriod, 0, 0, nil), ctxConsistency(0))
	if got != 1 {
		t.Fatalf("zero target: got %v, want 1", got)
	}
}

func TestIsMilestoneReached_DaysInPeriod(t *testing.T) {
	if IsMilestoneReached(makeChallenge(MilestoneDaysInPeriod, 20, 19, nil), ctxConsistency(0)) {
		t.Fatal("19/20 should not be reached")
	}
	if !IsMilestoneReached(makeChallenge(MilestoneDaysInPeriod, 20, 20, nil), ctxConsistency(0)) {
		t.Fatal("20/20 should be reached")
	}
	if !IsMilestoneReached(makeChallenge(MilestoneDaysInPeriod, 20, 25, nil), ctxConsistency(0)) {
		t.Fatal("25/20 should be reached")
	}
}

func TestCalculateProgress_TotalCompletions(t *testing.T) {
	got := CalculateProgress(makeChallenge(MilestoneTotalCompletions, 100, 33, nil), ctxConsistency(0))
	if math.Abs(got-0.33) > 1e-9 {
		t.Fatalf("got %v, want 0.33", got)
	}
	if CalculateProgress(makeChallenge(MilestoneTotalCompletions, 100, 100, nil), ctxConsistency(0)) != 1 {
		t.Fatal("at target")
	}
	if CalculateProgress(makeChallenge(MilestoneTotalCompletions, 100, 150, nil), ctxConsistency(0)) != 1 {
		t.Fatal("above clamped")
	}
	if CalculateProgress(makeChallenge(MilestoneTotalCompletions, 0, 0, nil), ctxConsistency(0)) != 1 {
		t.Fatal("zero target")
	}
}

func TestCalculateProgress_CustomDateRange(t *testing.T) {
	if CalculateProgress(makeChallenge(MilestoneCustomDateRange, 90, 0, nil), ctxConsistency(0)) != 0 {
		t.Fatal("zero")
	}
	if CalculateProgress(makeChallenge(MilestoneCustomDateRange, 90, 0, nil), ctxConsistency(90)) != 1 {
		t.Fatal("at target")
	}
	if !IsMilestoneReached(makeChallenge(MilestoneCustomDateRange, 90, 0, nil), ctxConsistency(90)) {
		t.Fatal("reached")
	}
	if IsMilestoneReached(makeChallenge(MilestoneCustomDateRange, 90, 0, nil), ctxConsistency(89)) {
		t.Fatal("not reached")
	}
}

func TestCalculateProgress_ImprovementMilestone(t *testing.T) {
	baseline := 50.0
	cases := []struct {
		name string
		cur  float64
		want float64
	}{
		{"no improvement", 50, 0},
		{"halfway", 60, 0.5},
		{"at target", 70, 1},
		{"above", 80, 1},
		{"decline", 40, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := CalculateProgress(makeChallenge(MilestoneImprovementMilestone, 20, 0, &baseline), ctxConsistency(tc.cur))
			if got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
	// null baseline treated as 0
	got := CalculateProgress(makeChallenge(MilestoneImprovementMilestone, 20, 0, nil), ctxConsistency(20))
	if got != 1 {
		t.Fatalf("null baseline: got %v, want 1", got)
	}
	if CalculateProgress(makeChallenge(MilestoneImprovementMilestone, 0, 0, &baseline), ctxConsistency(50)) != 1 {
		t.Fatal("zero target")
	}
	if !IsMilestoneReached(makeChallenge(MilestoneImprovementMilestone, 20, 0, &baseline), ctxConsistency(70)) {
		t.Fatal("reached at target")
	}
	if IsMilestoneReached(makeChallenge(MilestoneImprovementMilestone, 20, 0, &baseline), ctxConsistency(69)) {
		t.Fatal("not reached below")
	}
}

func TestCalculateProgress_AllTypes_ZeroTarget_Returns1(t *testing.T) {
	types := []MilestoneType{
		MilestoneConsistencyTarget, MilestoneDaysInPeriod, MilestoneTotalCompletions,
		MilestoneCustomDateRange, MilestoneImprovementMilestone,
	}
	baseline := 0.0
	for _, mt := range types {
		got := CalculateProgress(makeChallenge(mt, 0, 0, &baseline), ctxConsistency(0))
		if got != 1 {
			t.Fatalf("%s: got %v, want 1", mt, got)
		}
	}
}

func TestEffectiveStatus_DerivesExpired(t *testing.T) {
	now := mustParseTime(t, "2026-07-12T12:00:00Z")
	active := Challenge{Status: StatusActive, EndsAt: mustParseTime(t, "2026-07-11T12:00:00Z")}
	if EffectiveStatus(active, now) != "expired" {
		t.Fatal("active past endsAt should be expired")
	}
	still := Challenge{Status: StatusActive, EndsAt: mustParseTime(t, "2026-07-13T12:00:00Z")}
	if EffectiveStatus(still, now) != "active" {
		t.Fatal("active before endsAt should be active")
	}
	if EffectiveStatus(Challenge{Status: StatusCompleted}, now) != "completed" {
		t.Fatal("completed")
	}
}

func TestProcessedDates_Dedupe(t *testing.T) {
	c := Challenge{}
	dates := c.GetProcessedDates()
	dates["2026-03-05"] = struct{}{}
	c.SetProcessedDates(dates)
	if c.CompletionCount != 1 {
		t.Fatalf("count=%d", c.CompletionCount)
	}
	again := c.GetProcessedDates()
	if _, ok := again["2026-03-05"]; !ok {
		t.Fatal("missing date after roundtrip")
	}
	if _, exists := again["2026-03-05"]; exists {
		// re-add should be detected by caller
		delete(again, "x")
	}
	again["2026-03-05"] = struct{}{}
	if len(again) != 1 {
		t.Fatal("dedupe map size")
	}
}

func mustParseTime(t *testing.T, s string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
