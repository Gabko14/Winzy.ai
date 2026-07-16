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
// winzy-db` locally before running integration tests; ConnectParallel skips
// the test with a clear message when TEST_DATABASE_URL is unset, so a plain
// `go test ./...` without a database stays green rather than hanging or
// failing cryptically.
//
// Usage: build integration-only test files with `//go:build integration`
// so `go test ./...` (no real DB required) stays green everywhere, and CI
// additionally runs `go test -tags=integration -race ./...` with
// TEST_DATABASE_URL pointed at a live Postgres.
//
// PER-TEST DATABASES (winzy.ai-utzz / winzy.ai-zfa3): ConnectParallel clones
// a pre-migrated per-package template into a process-unique database for
// each test. Fully isolated callers need no test-lifetime advisory lock or
// truncate. Template preparation and the short CREATE DATABASE ... TEMPLATE
// operation are still serialized across processes on the maintenance
// database; each clone is dropped in t.Cleanup. Package names still derive
// from os.Getwd() (go test sets CWD to the package source dir) so parallel
// packages never share templates.
package dbtest

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/db"
)

var (
	templateByURL     sync.Map // string -> *migrateOnce
	migrateFn         = db.Migrate
	parallelDBCounter atomic.Uint64
)

type migrateOnce struct {
	once sync.Once
	err  error
}

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

// ConnectParallel returns a pool backed by a fully isolated per-test database
// cloned from a pre-migrated per-package template. It neither truncates shared
// tables nor holds a test-lifetime advisory lock, so callers may safely use
// t.Parallel. The clone name combines the process ID with an atomic
// per-process counter, and the clone is dropped after the caller's own
// cleanup functions finish. It skips the test (rather than failing) when
// TEST_DATABASE_URL is unset, so `go test ./...` without a database available
// still passes.
func ConnectParallel(t *testing.T) *pgxpool.Pool {
	t.Helper()

	baseURL := os.Getenv("TEST_DATABASE_URL")
	if baseURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping integration test (see internal/dbtest doc comment)")
	}

	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("dbtest: resolving package working directory: %v", err)
	}
	packageDBName := packageTestDBName(wd)
	templateName := suffixedTestDBName(packageDBName, "tmpl")
	templateURL, err := rewriteDatabaseURL(baseURL, templateName)
	if err != nil {
		t.Fatalf("dbtest: rewriting TEST_DATABASE_URL for template DB: %v", err)
	}

	stateValue, _ := templateByURL.LoadOrStore(templateURL, &migrateOnce{})
	state := stateValue.(*migrateOnce)
	state.once.Do(func() {
		state.err = ensureTemplateDatabase(context.Background(), baseURL, templateName, templateURL)
	})
	if state.err != nil {
		t.Fatalf("dbtest: ensuring template database %s: %v", templateName, state.err)
	}

	suffix := fmt.Sprintf("%d_%d", os.Getpid(), parallelDBCounter.Add(1))
	dbName := suffixedTestDBName(packageDBName, suffix)
	ctx := context.Background()
	if err := cloneTemplateDatabase(ctx, baseURL, dbName, templateName); err != nil {
		t.Fatalf("dbtest: creating isolated database: %v", err)
	}

	var pool *pgxpool.Pool
	t.Cleanup(func() {
		if pool != nil {
			pool.Close()
		}
		if err := dropTestDatabase(context.Background(), baseURL, dbName); err != nil {
			t.Errorf("dbtest: dropping isolated database: %v", err)
		}
	})

	databaseURL, err := rewriteDatabaseURL(baseURL, dbName)
	if err != nil {
		t.Fatalf("dbtest: rewriting TEST_DATABASE_URL for isolated DB: %v", err)
	}
	pool, err = db.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("dbtest: connecting to isolated database %s: %v", dbName, err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("dbtest: pinging isolated database %s: %v", dbName, err)
	}
	return pool
}
