package dbtest

import (
	"errors"
	"sync/atomic"
	"testing"
)

var errMigrateBoom = errors.New("dbtest: migrate boom")

func TestEnsureMigrated_OncePerURL(t *testing.T) {
	var calls atomic.Int32
	prev := migrateFn
	migrateFn = func(string) error {
		calls.Add(1)
		return nil
	}
	t.Cleanup(func() { migrateFn = prev })

	url := "postgres://dbtest/ensure-migrated/" + t.Name()
	if err := ensureMigrated(url); err != nil {
		t.Fatalf("first ensureMigrated: %v", err)
	}
	if err := ensureMigrated(url); err != nil {
		t.Fatalf("second ensureMigrated: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("migrate calls for same URL: got %d want 1", got)
	}

	other := url + "/other"
	if err := ensureMigrated(other); err != nil {
		t.Fatalf("ensureMigrated other URL: %v", err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("migrate calls after second URL: got %d want 2", got)
	}
}

func TestEnsureMigrated_PropagatesError(t *testing.T) {
	prev := migrateFn
	migrateFn = func(string) error { return errMigrateBoom }
	t.Cleanup(func() { migrateFn = prev })

	url := "postgres://dbtest/ensure-migrated-err/" + t.Name()
	if err := ensureMigrated(url); err != errMigrateBoom {
		t.Fatalf("first ensureMigrated error: got %v want %v", err, errMigrateBoom)
	}
	if err := ensureMigrated(url); err != errMigrateBoom {
		t.Fatalf("cached ensureMigrated error: got %v want %v", err, errMigrateBoom)
	}
}
