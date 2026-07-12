// Package restore creates winzy_mig_src_* databases and pg_restores each dump
// via a postgres:18-alpine client container (production dumps are PG 18.4).
package restore

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/jackc/pgx/v5"

	"winzy.ai/migrate/internal/config"
)

// Sources creates each winzy_mig_src_* database (drop/recreate) and restores
// the matching custom-format dump. Never touches winzy or winzy_parity.
func Sources(ctx context.Context, cfg config.Config) error {
	if err := cfg.ValidateArchive(); err != nil {
		return err
	}
	conn, err := pgx.Connect(ctx, cfg.AdminURL)
	if err != nil {
		return fmt.Errorf("restore: connect admin: %w", err)
	}
	defer conn.Close(ctx)

	for _, svc := range config.SourceServices {
		if err := config.AssertNotForbidden(svc.DB); err != nil {
			return err
		}
		if err := recreateDB(ctx, conn, svc.DB); err != nil {
			return err
		}
		if err := pgRestore(cfg, svc); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "restore: %s -> %s OK\n", svc.DumpFile, svc.DB)
	}
	return nil
}

// Target creates (drop/recreate) winzy_rehearsal. Schema application is separate.
func Target(ctx context.Context, cfg config.Config) error {
	if err := config.AssertNotForbidden(config.TargetDB); err != nil {
		return err
	}
	conn, err := pgx.Connect(ctx, cfg.AdminURL)
	if err != nil {
		return fmt.Errorf("restore: connect admin: %w", err)
	}
	defer conn.Close(ctx)
	if err := recreateDB(ctx, conn, config.TargetDB); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "restore: created %s\n", config.TargetDB)
	return nil
}

func recreateDB(ctx context.Context, admin *pgx.Conn, name string) error {
	if err := config.AssertNotForbidden(name); err != nil {
		return err
	}
	// Terminate leftover sessions so DROP succeeds during idempotent reruns.
	_, _ = admin.Exec(ctx, `
		SELECT pg_terminate_backend(pid)
		FROM pg_stat_activity
		WHERE datname = $1 AND pid <> pg_backend_pid()`, name)
	_, err := admin.Exec(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s", quoteIdent(name)))
	if err != nil {
		return fmt.Errorf("restore: drop %s: %w", name, err)
	}
	_, err = admin.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s OWNER %s", quoteIdent(name), quoteIdent(config.DefaultUser)))
	if err != nil {
		return fmt.Errorf("restore: create %s: %w", name, err)
	}
	return nil
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func pgRestore(cfg config.Config, svc config.SourceService) error {
	dumpHostPath := cfg.DumpPath(svc)
	args := []string{
		"run", "--network", "host",
		"-e", "PGPASSWORD=" + cfg.Password,
		"-v", cfg.ArchiveDir + ":/dumps:ro",
		cfg.DockerImage,
		"pg_restore",
		"-h", cfg.Host,
		"-p", cfg.Port,
		"-U", cfg.User,
		"-d", svc.DB,
		"--no-owner",
		"--no-acl",
		"--verbose",
		"/dumps/" + svc.DumpFile,
	}
	cmd := exec.Command("docker", args...)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("restore: pg_restore %s (dump %s): %w — ensure winzy-db major version accepts PG18 dumps", svc.DB, dumpHostPath, err)
	}
	return nil
}
