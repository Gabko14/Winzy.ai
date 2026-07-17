//go:build integration

package habits

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/dbtest"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
)

func TestHasUncompletedDueHabits_HappyPathAndEdges(t *testing.T) {
	t.Parallel()
	pool := dbtest.ConnectParallel(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := NewService(pool, events.New(logger), export.New(logger), logger)

	userID := "00000000-0000-4000-8000-0000000000d1"
	day := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC) // Friday

	ok, err := svc.HasUncompletedDueHabits(context.Background(), userID, day)
	if err != nil {
		t.Fatalf("empty: %v", err)
	}
	if ok {
		t.Fatal("no habits → false")
	}

	daily, err := svc.CreateHabit(context.Background(), userID, CreateHabitRequest{Name: "Daily"})
	if err != nil {
		t.Fatalf("CreateHabit daily: %v", err)
	}
	ok, err = svc.HasUncompletedDueHabits(context.Background(), userID, day)
	if err != nil || !ok {
		t.Fatalf("due incomplete daily: ok=%v err=%v", ok, err)
	}

	_, _, err = svc.CompleteHabit(context.Background(), userID, daily.ID, CompleteHabitRequest{
		Timezone: "UTC", Date: strPtr("2026-07-17"),
	})
	if err != nil {
		t.Fatalf("CompleteHabit: %v", err)
	}
	ok, err = svc.HasUncompletedDueHabits(context.Background(), userID, day)
	if err != nil || ok {
		t.Fatalf("all complete → false: ok=%v err=%v", ok, err)
	}

	wd := int(day.Weekday()) // Friday = 5
	custom, err := svc.CreateHabit(context.Background(), userID, CreateHabitRequest{
		Name: "Custom Fri", Frequency: freqPtr(FrequencyCustom), CustomDays: []int{wd},
	})
	if err != nil {
		t.Fatalf("CreateHabit custom: %v", err)
	}
	_ = custom
	ok, err = svc.HasUncompletedDueHabits(context.Background(), userID, day)
	if err != nil || !ok {
		t.Fatalf("custom due incomplete: ok=%v err=%v", ok, err)
	}

	otherDay := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC) // Saturday — custom not due; daily already done on Fri only
	// daily was completed only for Friday; Saturday daily is still due
	ok, err = svc.HasUncompletedDueHabits(context.Background(), userID, otherDay)
	if err != nil || !ok {
		t.Fatalf("Saturday daily still due: ok=%v err=%v", ok, err)
	}
}

func strPtr(s string) *string { return &s }

func freqPtr(f Frequency) *Frequency { return &f }
