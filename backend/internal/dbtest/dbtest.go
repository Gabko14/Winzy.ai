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
// additionally runs `go test -tags=integration -race ./...` with
// TEST_DATABASE_URL pointed at a live Postgres.
//
// PER-PACKAGE DATABASES (winzy.ai-edxi): Connect rewrites TEST_DATABASE_URL's
// dbname to winzy_test_<package>_<hash> derived from os.Getwd() (go test sets
// CWD to the package source dir), auto-creates that database on first use,
// and migrates it via the b8z5 migrate-once cache. Packages no longer share
// truncate state, so multi-package runs do NOT need -p 1. The advisory lock
// (rdc7.14) remains — it is scoped per database, so it only serializes tests
// within one package (and across processes on that same package DB).
//
// PARALLEL PATH (winzy.ai-utzz): ConnectParallel clones a pre-migrated
// per-package template into a process-unique database for each test. Fully
// isolated callers need no test-lifetime advisory lock or truncate. Template
// preparation and the short CREATE DATABASE ... TEMPLATE operation are still
// serialized across processes on the maintenance database; each clone is
// dropped in t.Cleanup.
//
// FAST-PATH (winzy.ai-b8z5): migrations run once per process+database URL
// (sync.Once), and the truncate table list is cached per URL for the
// process lifetime. Truncate semantics and the advisory-lock sequence stay
// unchanged: lock → truncate → test → unlock.
package dbtest

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/db"
)

// integrationAdvisoryLockKey is the fixed session advisory lock all
// dbtest.Connect callers share so concurrent suites on the same database
// cannot truncate each other mid-test. Per-database scoping (Postgres) means
// each winzy_test_* database has its own lock namespace — no re-key needed
// for winzy.ai-edxi.
const integrationAdvisoryLockKey int64 = 0x57696e7a79444254 // "WinzyDBT"

var (
	migrateByURL      sync.Map // string -> *migrateOnce
	tablesByURL       sync.Map // string -> *tablesOnce
	templateByURL     sync.Map // string -> *migrateOnce
	migrateFn         = db.Migrate
	parallelDBCounter atomic.Uint64
)

type migrateOnce struct {
	once sync.Once
	err  error
}

type tablesOnce struct {
	once   sync.Once
	tables []string
	err    error
}

func ensureMigrated(databaseURL string) error {
	v, _ := migrateByURL.LoadOrStore(databaseURL, &migrateOnce{})
	state := v.(*migrateOnce)
	state.once.Do(func() {
		state.err = migrateFn(databaseURL)
	})
	return state.err
}

func cachedPublicTables(ctx context.Context, pool *pgxpool.Pool, databaseURL string) ([]string, error) {
	v, _ := tablesByURL.LoadOrStore(databaseURL, &tablesOnce{})
	state := v.(*tablesOnce)
	state.once.Do(func() {
		rows, err := pool.Query(ctx, `
			SELECT tablename FROM pg_tables
			WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
		`)
		if err != nil {
			state.err = err
			return
		}
		defer rows.Close()

		var tables []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				state.err = err
				return
			}
			tables = append(tables, name)
		}
		if err := rows.Err(); err != nil {
			state.err = err
			return
		}
		state.tables = tables
	})
	return state.tables, state.err
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

// Connect returns a pool connected to a per-package test database derived
// from TEST_DATABASE_URL (winzy.ai-edxi), with migrations applied and every
// table truncated before the test runs. Callers still set TEST_DATABASE_URL
// to the shared winzy URL; Connect rewrites the dbname internally and
// auto-creates winzy_test_* databases as needed. It skips the test (rather
// than failing) when TEST_DATABASE_URL is unset, so `go test ./...` without
// a database available still passes. A session advisory lock is held on a
// dedicated connection for the whole test (see package doc); the pool, lock,
// and connection are released via t.Cleanup.
func Connect(t *testing.T) *pgxpool.Pool {
	t.Helper()

	baseURL := os.Getenv("TEST_DATABASE_URL")
	if baseURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping integration test (see internal/dbtest doc comment)")
	}

	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("dbtest: resolving package working directory: %v", err)
	}
	dbName := packageTestDBName(wd)
	pkgURL, err := rewriteDatabaseURL(baseURL, dbName)
	if err != nil {
		t.Fatalf("dbtest: rewriting TEST_DATABASE_URL for package DB: %v", err)
	}

	ctx := context.Background()
	if err := ensurePackageDatabase(ctx, baseURL, dbName); err != nil {
		t.Fatalf("dbtest: ensuring package database %s: %v", dbName, err)
	}

	if err := ensureMigrated(pkgURL); err != nil {
		t.Fatalf("dbtest: applying migrations to package database %s: %v", dbName, err)
	}

	pool, err := db.New(ctx, pkgURL)
	if err != nil {
		t.Fatalf("dbtest: connecting to package database %s: %v", dbName, err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("dbtest: pinging package database %s: %v", dbName, err)
	}

	lockConn, err := pgx.Connect(ctx, pkgURL)
	if err != nil {
		pool.Close()
		t.Fatalf("dbtest: opening advisory-lock connection: %v", err)
	}
	if _, err := lockConn.Exec(ctx, `SELECT pg_advisory_lock($1)`, integrationAdvisoryLockKey); err != nil {
		_ = lockConn.Close(ctx)
		pool.Close()
		t.Fatalf("dbtest: acquiring integration advisory lock: %v", err)
	}

	Truncate(t, pool, pkgURL)

	t.Cleanup(func() {
		if _, err := lockConn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, integrationAdvisoryLockKey); err != nil {
			t.Errorf("dbtest: releasing integration advisory lock: %v", err)
		}
		_ = lockConn.Close(context.Background())
		pool.Close()
	})

	return pool
}

// ConnectParallel returns a pool backed by a fully isolated per-test database
// cloned from a pre-migrated per-package template. Unlike Connect, it neither
// truncates shared tables nor holds a test-lifetime advisory lock, so callers
// may safely use t.Parallel. The clone name combines the process ID with an
// atomic per-process counter, and the clone is dropped after the caller's own
// cleanup functions finish.
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

// Truncate empties every user table in the public schema (excluding
// golang-migrate's own schema_migrations bookkeeping table) so each test
// starts from a clean slate regardless of what a previous test left behind.
// databaseURL keys the process-lifetime table-list cache (winzy.ai-b8z5).
func Truncate(t *testing.T, pool *pgxpool.Pool, databaseURL string) {
	t.Helper()
	ctx := context.Background()

	tables, err := cachedPublicTables(ctx, pool, databaseURL)
	if err != nil {
		t.Fatalf("dbtest: listing tables to truncate: %v", err)
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
