// Package db wires up the single Postgres connection pool shared by every
// module in the service, and applies schema migrations on startup.
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// maxPoolConns caps the pool at a small, fixed size rather than pgxpool's
// default (4x GOMAXPROCS, easily 16-32+ on a modern container). This is one
// Go service instance on Railway talking to one Postgres instance that every
// module shares — there's no per-service pool to divide a bigger budget
// across, so an unbounded pool just lets a single slow/bulk request (e.g. a
// large data export) starve every other request of connections. 20 is
// comfortably above normal concurrent request volume for a single-instance
// deployment while still leaving Postgres's own max_connections headroom for
// migrations, psql sessions, etc.
const maxPoolConns = 20

// New creates a pgx connection pool for databaseURL. It does not verify
// connectivity; call Pool.Ping (or the returned pool's Ping method) once the
// caller is ready to fail fast on a broken connection.
func New(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: parsing connection string: %w", err)
	}
	cfg.MaxConns = maxPoolConns

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: creating connection pool: %w", err)
	}
	return pool, nil
}
