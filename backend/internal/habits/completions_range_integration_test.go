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

// Same-created_at habits must stay contiguous under ORDER BY created_at, id
// so CompletionsInRange's consecutive-ID grouping never emits duplicate
// habit entries with partial day arrays.
func TestCompletionsInRange_EdgeCase_IdenticalCreatedAtGroupsWithoutInterleave(t *testing.T) {
	t.Parallel()
	pool := dbtest.ConnectParallel(t)
	ctx := context.Background()
	userID := "10000000-0000-4000-8000-000000000090"

	h1, err := createHabit(ctx, pool, userID, CreateHabitRequest{Name: "Alpha"}, FrequencyDaily, nil)
	if err != nil {
		t.Fatalf("createHabit Alpha: %v", err)
	}
	h2, err := createHabit(ctx, pool, userID, CreateHabitRequest{Name: "Beta"}, FrequencyDaily, nil)
	if err != nil {
		t.Fatalf("createHabit Beta: %v", err)
	}

	same := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	if _, err := pool.Exec(ctx,
		`UPDATE habits SET created_at = $1 WHERE id = $2::uuid OR id = $3::uuid`,
		same, h1.ID, h2.ID); err != nil {
		t.Fatalf("forcing identical created_at: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := NewService(pool, events.New(logger), export.New(logger), logger)

	from, to := "2026-03-10", "2026-03-12"
	resp, err := svc.CompletionsInRange(ctx, userID, from, to)
	if err != nil {
		t.Fatalf("CompletionsInRange: %v", err)
	}
	if len(resp.Habits) != 2 {
		t.Fatalf("Habits len = %d, want exactly 2 grouped entries (got %+v)", len(resp.Habits), resp.Habits)
	}
	for _, h := range resp.Habits {
		if len(h.Days) != 3 {
			t.Errorf("habit %s (%s) Days = %d, want full 3-day array", h.ID, h.Name, len(h.Days))
		}
	}
	// Stable order: created_at tie → id ascending.
	first, second := h1, h2
	if h2.ID < h1.ID {
		first, second = h2, h1
	}
	if resp.Habits[0].ID != first.ID || resp.Habits[1].ID != second.ID {
		t.Errorf("order = [%s, %s], want [%s, %s] (created_at tiebreak by id)",
			resp.Habits[0].ID, resp.Habits[1].ID, first.ID, second.ID)
	}

	listed, err := listHabits(ctx, pool, userID)
	if err != nil {
		t.Fatalf("listHabits: %v", err)
	}
	if len(listed) != 2 || listed[0].ID != first.ID || listed[1].ID != second.ID {
		t.Errorf("listHabits order = %v, want lockstep with range [%s, %s]",
			[]string{listed[0].ID, listed[1].ID}, first.ID, second.ID)
	}
}
