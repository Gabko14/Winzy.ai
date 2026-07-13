// Package schema applies the Go backend's SQL migrations to winzy_rehearsal
// via golang-migrate's file source (tools/migrate cannot import
// backend/internal/db — Go's internal/ visibility rule).
package schema

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	"winzy.ai/migrate/internal/config"
)

// Apply runs every pending up migration against cfg.TargetURL().
func Apply(cfg config.Config) error {
	db, err := cfg.EffectiveTargetDB()
	if err != nil {
		return err
	}
	dir, err := migrationsDir()
	if err != nil {
		return err
	}
	sourceURL := "file://" + filepath.ToSlash(dir)
	m, err := migrate.New(sourceURL, cfg.TargetURL())
	if err != nil {
		return fmt.Errorf("schema: migrate.New: %w", err)
	}
	defer func() { _, _ = m.Close() }()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("schema: applying migrations from %s: %w", dir, err)
	}
	fmt.Fprintf(os.Stderr, "schema: migrations applied to %s from %s\n", db, dir)
	return nil
}

func migrationsDir() (string, error) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("schema: resolving migrations path")
	}
	// internal/schema -> tools/migrate -> repo root -> backend/migrations
	dir := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..", "backend", "migrations"))
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return "", fmt.Errorf("schema: backend migrations dir %s: %w", dir, err)
	}
	return dir, nil
}
