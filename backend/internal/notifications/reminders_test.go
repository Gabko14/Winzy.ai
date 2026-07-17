package notifications

import (
	"testing"
	"time"
)

func TestInReminderWindow_HappyPath_AndEdges(t *testing.T) {
	rem := time.Date(0, 1, 1, 19, 0, 0, 0, time.UTC)

	cases := []struct {
		name string
		now  time.Time
		want bool
	}{
		{"exact", time.Date(2026, 7, 17, 19, 0, 0, 0, time.UTC), true},
		{"plus14", time.Date(2026, 7, 17, 19, 14, 0, 0, time.UTC), true},
		{"plus15", time.Date(2026, 7, 17, 19, 15, 0, 0, time.UTC), false},
		{"before", time.Date(2026, 7, 17, 18, 59, 0, 0, time.UTC), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := inReminderWindow(tc.now, rem); got != tc.want {
				t.Errorf("inReminderWindow(%s) = %v, want %v", tc.now.Format("15:04"), got, tc.want)
			}
		})
	}
}

func TestInReminderWindow_EdgeCase_WrapsMidnight(t *testing.T) {
	rem := time.Date(0, 1, 1, 23, 50, 0, 0, time.UTC)
	now := time.Date(2026, 7, 18, 0, 2, 0, 0, time.UTC)
	if !inReminderWindow(now, rem) {
		t.Fatal("00:02 should be inside 23:50 + 15m window")
	}
}

func TestParseReminderTime_ErrorCase_RejectsBad(t *testing.T) {
	if _, err := parseReminderTime("19:00:00"); err == nil {
		t.Fatal("expected error for seconds")
	}
	if _, err := parseReminderTime("25:00"); err == nil {
		t.Fatal("expected error for invalid hour")
	}
	if _, err := parseReminderTime("19:00"); err != nil {
		t.Fatalf("19:00 should parse: %v", err)
	}
}
