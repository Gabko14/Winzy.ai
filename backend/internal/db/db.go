// Package db wires up the single Postgres connection pool shared by every
// module in the service, and applies schema migrations on startup.
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// New creates a pgx connection pool for databaseURL. It does not verify
// connectivity; call Pool.Ping (or the returned pool's Ping method) once the
// caller is ready to fail fast on a broken connection.
func New(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: creating connection pool: %w", err)
	}
	return pool, nil
}
