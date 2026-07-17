//go:build integration

package habits

import (
	"context"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/dbtest"
)

// Proves the 0010 backfill SQL assigns deterministic 0-based positions by
// created_at, id — including for archived rows — when re-applied after a
// scramble (dbtest templates already ran Up; this re-runs the UPDATE body).
func TestHabitPositions_Backfill_DeterministicCreatedAtOrder(t *testing.T) {
	t.Parallel()
	pool := dbtest.ConnectParallel(t)
	ctx := context.Background()
	userID := "10000000-0000-4000-8000-000000000091"

	h1, err := createHabit(ctx, pool, userID, CreateHabitRequest{Name: "Late"}, FrequencyDaily, nil)
	if err != nil {
		t.Fatalf("createHabit: %v", err)
	}
	h2, err := createHabit(ctx, pool, userID, CreateHabitRequest{Name: "Early"}, FrequencyDaily, nil)
	if err != nil {
		t.Fatalf("createHabit: %v", err)
	}
	h3, err := createHabit(ctx, pool, userID, CreateHabitRequest{Name: "Mid"}, FrequencyDaily, nil)
	if err != nil {
		t.Fatalf("createHabit: %v", err)
	}

	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	t1 := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 1, 3, 0, 0, 0, 0, time.UTC)
	for _, row := range []struct {
		id string
		at time.Time
	}{
		{h2.ID, t0},
		{h3.ID, t1},
		{h1.ID, t2},
	} {
		if _, err := pool.Exec(ctx, `UPDATE habits SET created_at = $1 WHERE id = $2::uuid`, row.at, row.id); err != nil {
			t.Fatalf("set created_at: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE habits SET archived_at = now() WHERE id = $1::uuid`, h3.ID); err != nil {
		t.Fatalf("archive mid: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE habits SET position = 99 WHERE user_id = $1::uuid`, userID); err != nil {
		t.Fatalf("scramble positions: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE habits AS h
		SET position = sub.rn - 1
		FROM (
			SELECT id,
			       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
			FROM habits
		) AS sub
		WHERE h.id = sub.id`); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	var positions []struct {
		ID       string
		Position int
	}
	rows, err := pool.Query(ctx, `
		SELECT id::text, position FROM habits
		WHERE user_id = $1::uuid
		ORDER BY position ASC`, userID)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var p struct {
			ID       string
			Position int
		}
		if err := rows.Scan(&p.ID, &p.Position); err != nil {
			t.Fatalf("scan: %v", err)
		}
		positions = append(positions, p)
	}
	want := []string{h2.ID, h3.ID, h1.ID}
	if len(positions) != 3 {
		t.Fatalf("got %d rows, want 3", len(positions))
	}
	for i, id := range want {
		if positions[i].ID != id || positions[i].Position != i {
			t.Errorf("positions[%d] = {%s,%d}, want {%s,%d}", i, positions[i].ID, positions[i].Position, id, i)
		}
	}
}
