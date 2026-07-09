package db_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Gabko14/winzy/backend/internal/db"
)

// fakeQuerier is a minimal db.Querier double distinguished only by name, so
// tests can assert on identity (which fake came back) without a real
// Postgres connection.
type fakeQuerier struct {
	name string
}

func (f *fakeQuerier) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (f *fakeQuerier) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return nil
}

func (f *fakeQuerier) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return nil, nil
}

func TestQuerierFrom_HappyPath_ReturnsOverrideWhenSet(t *testing.T) {
	fallback := &fakeQuerier{name: "fallback"}
	override := &fakeQuerier{name: "override"}

	ctx := db.WithQuerier(context.Background(), override)

	got := db.QuerierFrom(ctx, fallback)
	if got != db.Querier(override) {
		t.Errorf("QuerierFrom() = %v, want the overridden querier %v", got, override)
	}
}

func TestQuerierFrom_EdgeCase_ReturnsFallbackWhenUnset(t *testing.T) {
	fallback := &fakeQuerier{name: "fallback"}

	got := db.QuerierFrom(context.Background(), fallback)
	if got != db.Querier(fallback) {
		t.Errorf("QuerierFrom() = %v, want the fallback querier %v", got, fallback)
	}
}

func TestQuerierFrom_EdgeCase_NestedOverrideWinsOverOuter(t *testing.T) {
	fallback := &fakeQuerier{name: "fallback"}
	outer := &fakeQuerier{name: "outer"}
	inner := &fakeQuerier{name: "inner"}

	outerCtx := db.WithQuerier(context.Background(), outer)
	innerCtx := db.WithQuerier(outerCtx, inner)

	if got := db.QuerierFrom(innerCtx, fallback); got != db.Querier(inner) {
		t.Errorf("QuerierFrom(innerCtx) = %v, want the innermost override %v", got, inner)
	}
	// The outer context is unaffected by the nested WithQuerier call — an
	// independent derivation from it must still see "outer", proving
	// WithQuerier doesn't mutate anything shared between the two contexts.
	if got := db.QuerierFrom(outerCtx, fallback); got != db.Querier(outer) {
		t.Errorf("QuerierFrom(outerCtx) = %v, want the outer override %v (untouched by the nested call)", got, outer)
	}
}
