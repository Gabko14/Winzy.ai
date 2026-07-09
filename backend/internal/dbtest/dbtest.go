// Package dbtest is the shared integration-test helper every module bead's
// handler tests use to run against a REAL Postgres instance.
//
// CONVENTION (documented per the PM REVIEW ADDENDUM on winzy.ai-rdc7.1):
// integration tests point at the compose "winzy-db" service via the
// TEST_DATABASE_URL env var, rather than spinning up testcontainers-go.
// Reasoning: every other Postgres instance in this repo is already a
// docker-compose service, the pre-push hook already assumes Docker is
// running, and CI already knows how to bring up a Postgres service
// container for a job — reusing that avoids a second, container-management
// dependency (testcontainers-go) and its Docker-in-Docker/socket-mounting
// concerns purely to duplicate what compose/CI service containers already
// do. The tradeoff is that a developer must remember to `docker compose up
// winzy-db` locally before running integration tests; Connect skips the
// test with a clear message when TEST_DATABASE_URL is unset, so a plain
// `go test ./...` without a database stays green rather than hanging or
// failing cryptically.
//
// Usage: build integration-only test files with `//go:build integration`
// so `go test ./...` (no real DB required) stays green everywhere, and CI
// additionally runs `go test -tags=integration -race -v ./...` with
// TEST_DATABASE_URL pointed at a live Postgres.
package dbtest

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/db"
)

// Connect returns a pool connected to TEST_DATABASE_URL with migrations
// applied and every table truncated before the test runs. It skips the test
// (rather than failing) when TEST_DATABASE_URL is unset, so `go test ./...`
// without a database available still passes. The pool and a final truncate
// are registered via t.Cleanup.
func Connect(t *testing.T) *pgxpool.Pool {
	t.Helper()

	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping integration test (see internal/dbtest doc comment)")
	}

	if err := db.Migrate(url); err != nil {
		t.Fatalf("dbtest: applying migrations to TEST_DATABASE_URL: %v", err)
	}

	ctx := context.Background()
	pool, err := db.New(ctx, url)
	if err != nil {
		t.Fatalf("dbtest: connecting to TEST_DATABASE_URL: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("dbtest: pinging TEST_DATABASE_URL: %v", err)
	}

	Truncate(t, pool)
	t.Cleanup(pool.Close)

	return pool
}

// Truncate empties every user table in the public schema (excluding
// golang-migrate's own schema_migrations bookkeeping table) so each test
// starts from a clean slate regardless of what a previous test left behind.
func Truncate(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	rows, err := pool.Query(ctx, `
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
	`)
	if err != nil {
		t.Fatalf("dbtest: listing tables to truncate: %v", err)
	}

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			t.Fatalf("dbtest: scanning table name: %v", err)
		}
		tables = append(tables, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("dbtest: iterating tables: %v", err)
	}

	if len(tables) == 0 {
		return
	}

	stmt := "TRUNCATE TABLE "
	for i, name := range tables {
		if i > 0 {
			stmt += ", "
		}
		stmt += fmt.Sprintf("%q", name)
	}
	stmt += " RESTART IDENTITY CASCADE"

	if _, err := pool.Exec(ctx, stmt); err != nil {
		t.Fatalf("dbtest: truncating tables: %v", err)
	}
}
