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
// additionally runs `go test -tags=integration -race -v -p 1 ./...` with
// TEST_DATABASE_URL pointed at a live Postgres.
//
// IMPORTANT: Connect holds a Postgres session advisory lock for the duration
// of each test on a dedicated connection (released in Cleanup). That
// serializes integration suites across packages AND processes/agents sharing
// winzy-db, so one test's Truncate cannot wipe another's rows mid-flight
// (intermittent spurious 404s; winzy.ai-rdc7.3.1 / winzy.ai-rdc7.14). The
// lock auto-releases if the process dies. Multi-package runs should still
// pass -p 1 so suites do not pile up waiting on the lock.
package dbtest

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/db"
)

// integrationAdvisoryLockKey is the fixed session advisory lock all
// dbtest.Connect callers share so concurrent suites on the same database
// cannot truncate each other mid-test.
const integrationAdvisoryLockKey int64 = 0x57696e7a79444254 // "WinzyDBT"

// RowExists is a raw-SQL existence check independent of any module's own
// store/service code, so cascade tests verify actual database state rather
// than re-trusting the same code the assertions are meant to catch bugs in.
// table is always one of a small hardcoded set of constants at each call
// site, not caller input — consolidated here (winzy.ai-rdc7.4) from
// duplicate copies in internal/auth and internal/habits' own
// cascade_integration_test.go files.
func RowExists(t *testing.T, pool *pgxpool.Pool, table, id string) bool {
	t.Helper()
	var exists bool
	query := fmt.Sprintf(`SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1::uuid)`, table)
	if err := pool.QueryRow(context.Background(), query, id).Scan(&exists); err != nil {
		t.Fatalf("checking %s row existence: %v", table, err)
	}
	return exists
}

// Connect returns a pool connected to TEST_DATABASE_URL with migrations
// applied and every table truncated before the test runs. It skips the test
// (rather than failing) when TEST_DATABASE_URL is unset, so `go test ./...`
// without a database available still passes. A session advisory lock is
// held on a dedicated connection for the whole test (see package doc); the
// pool, lock, and connection are released via t.Cleanup.
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

	lockConn, err := pgx.Connect(ctx, url)
	if err != nil {
		pool.Close()
		t.Fatalf("dbtest: opening advisory-lock connection: %v", err)
	}
	if _, err := lockConn.Exec(ctx, `SELECT pg_advisory_lock($1)`, integrationAdvisoryLockKey); err != nil {
		_ = lockConn.Close(ctx)
		pool.Close()
		t.Fatalf("dbtest: acquiring integration advisory lock: %v", err)
	}

	Truncate(t, pool)

	t.Cleanup(func() {
		if _, err := lockConn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, integrationAdvisoryLockKey); err != nil {
			t.Errorf("dbtest: releasing integration advisory lock: %v", err)
		}
		_ = lockConn.Close(context.Background())
		pool.Close()
	})

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
