package dbtest

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ensureTemplateDatabase creates and migrates a template database while
// holding its maintenance-database advisory lock. The lock prevents two test
// processes from migrating the same template concurrently on first use.
func ensureTemplateDatabase(ctx context.Context, baseURL, dbName, databaseURL string) error {
	maintURL, err := maintenanceDatabaseURL(baseURL)
	if err != nil {
		return err
	}
	conn, err := pgx.Connect(ctx, maintURL)
	if err != nil {
		return fmt.Errorf("dbtest: connect maintenance DB: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()

	lockKey := createAdvisoryLockKey(dbName)
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockKey); err != nil {
		return fmt.Errorf("dbtest: acquire template-database lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(ctx, `SELECT pg_advisory_unlock($1)`, lockKey)
	}()

	_, err = conn.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %s`, pgx.Identifier{dbName}.Sanitize()))
	if err != nil {
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42P04" {
			return fmt.Errorf("dbtest: CREATE template database %s: %w", dbName, err)
		}
	}
	if err := migrateFn(databaseURL); err != nil {
		return fmt.Errorf("dbtest: migrate template database %s: %w", dbName, err)
	}
	return nil
}

// cloneTemplateDatabase creates one fully isolated per-test database. Clones
// from a template are serialized across processes because CREATE DATABASE
// requires the template to have no active sessions.
func cloneTemplateDatabase(ctx context.Context, baseURL, dbName, templateName string) error {
	maintURL, err := maintenanceDatabaseURL(baseURL)
	if err != nil {
		return err
	}
	conn, err := pgx.Connect(ctx, maintURL)
	if err != nil {
		return fmt.Errorf("dbtest: connect maintenance DB: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()

	lockKey := createAdvisoryLockKey(templateName)
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockKey); err != nil {
		return fmt.Errorf("dbtest: acquire template-clone lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(ctx, `SELECT pg_advisory_unlock($1)`, lockKey)
	}()

	_, err = conn.Exec(ctx, fmt.Sprintf(
		`CREATE DATABASE %s TEMPLATE %s`,
		pgx.Identifier{dbName}.Sanitize(),
		pgx.Identifier{templateName}.Sanitize(),
	))
	if err != nil {
		return fmt.Errorf("dbtest: clone database %s from %s: %w", dbName, templateName, err)
	}
	return nil
}

func dropTestDatabase(ctx context.Context, baseURL, dbName string) error {
	maintURL, err := maintenanceDatabaseURL(baseURL)
	if err != nil {
		return err
	}
	conn, err := pgx.Connect(ctx, maintURL)
	if err != nil {
		return fmt.Errorf("dbtest: connect maintenance DB: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()

	if _, err := conn.Exec(ctx, fmt.Sprintf(`DROP DATABASE %s`, pgx.Identifier{dbName}.Sanitize())); err != nil {
		return fmt.Errorf("dbtest: DROP DATABASE %s: %w", dbName, err)
	}
	return nil
}
