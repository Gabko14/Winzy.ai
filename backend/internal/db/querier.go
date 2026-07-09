package db

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Querier is the minimal query surface every module's store functions run
// against — structurally identical to the private `querier` interfaces
// internal/auth/store.go and internal/habits/store.go already declare (see
// their doc comments for the ids-as-strings rationale). *pgxpool.Pool and
// pgx.Tx both satisfy it already, and so does any module's own private
// querier interface with the same three methods: Go interface satisfaction
// is structural, so nothing in auth or habits needs to change to accept a
// Querier value where it currently accepts its own querier.
//
// This type exists so a handler can be handed "whatever the caller is
// currently using" (a bare pool, or a transaction) via WithQuerier/
// QuerierFrom instead of every emitter having to pass its *pgxpool.Pool or
// pgx.Tx through Emit's payload directly.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// querierCtxKey is unexported so only WithQuerier can populate the context
// value QuerierFrom reads.
type querierCtxKey struct{}

// WithQuerier returns a copy of ctx carrying q as the querier a downstream
// QuerierFrom call should resolve to. An emitter that holds a transaction
// calls this before events.Emit so every handler registered for that event
// joins the same transaction (see internal/events' package doc for the
// contract this enables). Calling WithQuerier again on an already-tagged
// context overrides the previous value for anything derived from the new
// context — the standard context.WithValue nesting rule.
func WithQuerier(ctx context.Context, q Querier) context.Context {
	return context.WithValue(ctx, querierCtxKey{}, q)
}

// QuerierFrom returns the Querier WithQuerier stashed in ctx, or fallback if
// none was set. Store functions in any cascade path (a handler registered
// against events.Registry) must resolve their querier this way instead of
// closing over a raw *pgxpool.Pool directly, so they transparently join an
// emitter's transaction when one exists and fall back to the pool otherwise
// (e.g. a handler firing outside any transaction, or in a unit test with no
// tx in context).
func QuerierFrom(ctx context.Context, fallback Querier) Querier {
	if q, ok := ctx.Value(querierCtxKey{}).(Querier); ok {
		return q
	}
	return fallback
}
