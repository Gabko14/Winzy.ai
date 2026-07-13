//go:build integration

package dbtest

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Gabko14/winzy/backend/internal/db"
)

// TestMeasureConnectOverhead compares per-Connect cost of the pre-b8z5 path
// (migrate + pg_tables every call) vs current Connect (migrate-once + cached
// table list). Gated behind DBTEST_MEASURE=1 so normal suites stay fast.
func TestMeasureConnectOverhead(t *testing.T) {
	if os.Getenv("DBTEST_MEASURE") != "1" {
		t.Skip("set DBTEST_MEASURE=1 to run Connect overhead measurement")
	}

	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}

	const n = 100

	// Warm schema so "before" does not pay first-migrate cold start alone.
	if err := db.Migrate(url); err != nil {
		t.Fatalf("warm migrate: %v", err)
	}

	beforeTotal := time.Duration(0)
	for i := 0; i < n; i++ {
		start := time.Now()
		measureLegacyConnect(t, url)
		beforeTotal += time.Since(start)
	}

	// Warm fast-path caches.
	t.Run("warm_fastpath", func(t *testing.T) {
		_ = Connect(t)
	})

	afterTotal := time.Duration(0)
	for i := 0; i < n; i++ {
		start := time.Now()
		t.Run(fmt.Sprintf("fast_%d", i), func(t *testing.T) {
			_ = Connect(t)
		})
		afterTotal += time.Since(start)
	}

	t.Logf("BEFORE (migrate+pg_tables each Connect) n=%d total=%s avg=%s", n, beforeTotal, beforeTotal/n)
	t.Logf("AFTER  (migrate-once + cached tables)  n=%d total=%s avg=%s", n, afterTotal, afterTotal/n)
	if beforeTotal > 0 {
		t.Logf("speedup vs before: %.2fx", float64(beforeTotal)/float64(afterTotal))
	}
}

func measureLegacyConnect(t *testing.T, url string) {
	t.Helper()
	ctx := context.Background()

	if err := db.Migrate(url); err != nil {
		t.Fatalf("legacy migrate: %v", err)
	}

	pool, err := db.New(ctx, url)
	if err != nil {
		t.Fatalf("legacy pool: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("legacy ping: %v", err)
	}

	lockConn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatalf("legacy lock conn: %v", err)
	}
	if _, err := lockConn.Exec(ctx, `SELECT pg_advisory_lock($1)`, integrationAdvisoryLockKey); err != nil {
		_ = lockConn.Close(ctx)
		t.Fatalf("legacy lock: %v", err)
	}
	defer func() {
		_, _ = lockConn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, integrationAdvisoryLockKey)
		_ = lockConn.Close(context.Background())
	}()

	rows, err := pool.Query(ctx, `
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
	`)
	if err != nil {
		t.Fatalf("legacy list tables: %v", err)
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			t.Fatalf("legacy scan table: %v", err)
		}
		tables = append(tables, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("legacy tables err: %v", err)
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
		t.Fatalf("legacy truncate: %v", err)
	}
}
