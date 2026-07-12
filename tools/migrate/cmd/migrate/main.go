// Command migrate restores six production dumps into winzy_mig_src_* DBs,
// applies Go schema migrations to winzy_rehearsal, transforms+loads data,
// and emits a verification report (winzy.ai-rdc7.9).
//
//	migrate rehearse --archive DIR [--report FILE]
//	migrate restore-sources --archive DIR
//	migrate prepare-target
//	migrate load
//	migrate verify --report FILE
//	migrate mapping   # print enum mapping table (DB-free)
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"winzy.ai/migrate/internal/authcheck"
	"winzy.ai/migrate/internal/config"
	"winzy.ai/migrate/internal/enums"
	"winzy.ai/migrate/internal/load"
	"winzy.ai/migrate/internal/report"
	"winzy.ai/migrate/internal/restore"
	"winzy.ai/migrate/internal/schema"
	"winzy.ai/migrate/internal/verify"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	cfg := config.Default()
	switch os.Args[1] {
	case "rehearse":
		os.Exit(runRehearse(cfg, os.Args[2:]))
	case "restore-sources":
		os.Exit(runRestoreSources(cfg, os.Args[2:]))
	case "prepare-target":
		os.Exit(runPrepareTarget(cfg, os.Args[2:]))
	case "load":
		os.Exit(runLoad(cfg, os.Args[2:]))
	case "verify":
		os.Exit(runVerify(cfg, os.Args[2:]))
	case "mapping":
		fmt.Print(enums.MarkdownTable())
		os.Exit(0)
	case "-h", "--help", "help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand %q\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `usage: migrate <subcommand> [flags]

  mapping
      Print the per-enum mapping table (no database required).

	rehearse --archive DIR [--report FILE] [--admin-url URL]
      One-command idempotent rehearsal against winzy-mig-db (:5440 by default):
      recreate source DBs + pg_restore, recreate winzy_rehearsal + apply Go
      migrations, truncate+load, verify, auth-hash audit, write report.
      Never touches winzy-db (:5439) or databases winzy / winzy_parity.

  restore-sources --archive DIR [--admin-url URL]
      Create winzy_mig_src_{auth,habit,social,challenge,notification,activity}
      and pg_restore each dump via postgres:18-alpine.

  prepare-target [--admin-url URL]
      Create winzy_rehearsal and apply backend embedded migrations.

  load [--admin-url URL]
      Truncate target app tables and copy transformed rows from source DBs.

	verify --report FILE
      Emit verification report (row counts, orphans, distinct users, auth audit).

Defaults: admin postgres://winzy:winzy@localhost:5440/postgres?sslmode=disable
  (dedicated winzy-mig-db postgres:18 container — see README)
Archive must stay outside the repo (real user data).`)
}

func parseCommon(fs *flag.FlagSet, cfg *config.Config, args []string) error {
	fs.StringVar(&cfg.ArchiveDir, "archive", cfg.ArchiveDir, "path to 2026-07-12_1945 archive (read-only)")
	fs.StringVar(&cfg.AdminURL, "admin-url", cfg.AdminURL, "postgres admin URL (database postgres)")
	fs.StringVar(&cfg.ReportPath, "report", cfg.ReportPath, "verification report output path")
	fs.StringVar(&cfg.Host, "host", cfg.Host, "postgres host for docker pg_restore")
	fs.StringVar(&cfg.Port, "port", cfg.Port, "postgres port for docker pg_restore")
	fs.StringVar(&cfg.User, "user", cfg.User, "postgres user")
	fs.StringVar(&cfg.Password, "password", cfg.Password, "postgres password")
	fs.StringVar(&cfg.DockerImage, "docker-image", cfg.DockerImage, "postgres client image for pg_restore")
	return fs.Parse(args)
}

func runRehearse(cfg config.Config, args []string) int {
	fs := flag.NewFlagSet("rehearse", flag.ExitOnError)
	if err := parseCommon(fs, &cfg, args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	if err := restore.Sources(ctx, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "rehearse: %v\n", err)
		return 1
	}
	if err := restore.Target(ctx, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "rehearse: %v\n", err)
		return 1
	}
	if err := schema.Apply(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "rehearse: %v\n", err)
		return 1
	}
	loadRes, err := load.Run(ctx, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "rehearse: %v\n", err)
		return 1
	}
	vrep, err := verify.Run(ctx, cfg, loadRes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "rehearse: %v\n", err)
		return 1
	}
	arep, err := authcheck.Run(ctx, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "rehearse: %v\n", err)
		return 1
	}
	if err := report.Write(cfg.ReportPath, vrep, arep); err != nil {
		fmt.Fprintf(os.Stderr, "rehearse: %v\n", err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "rehearse: wrote %s (overall ok=%v)\n", cfg.ReportPath, vrep.OK && arep.OK)
	if !vrep.OK || !arep.OK {
		return 1
	}
	return 0
}

func runRestoreSources(cfg config.Config, args []string) int {
	fs := flag.NewFlagSet("restore-sources", flag.ExitOnError)
	if err := parseCommon(fs, &cfg, args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	if err := restore.Sources(ctx, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		return 1
	}
	return 0
}

func runPrepareTarget(cfg config.Config, args []string) int {
	fs := flag.NewFlagSet("prepare-target", flag.ExitOnError)
	if err := parseCommon(fs, &cfg, args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if err := restore.Target(ctx, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		return 1
	}
	if err := schema.Apply(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		return 1
	}
	return 0
}

func runLoad(cfg config.Config, args []string) int {
	fs := flag.NewFlagSet("load", flag.ExitOnError)
	if err := parseCommon(fs, &cfg, args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	res, err := load.Run(ctx, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		return 1
	}
	if len(res.Orphans) > 0 {
		fmt.Fprintf(os.Stderr, "load: %d orphan(s) reported — run verify for details\n", len(res.Orphans))
		return 1
	}
	return 0
}

func runVerify(cfg config.Config, args []string) int {
	fs := flag.NewFlagSet("verify", flag.ExitOnError)
	if err := parseCommon(fs, &cfg, args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	vrep, err := verify.Run(ctx, cfg, &load.Result{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		return 1
	}
	arep, err := authcheck.Run(ctx, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		return 1
	}
	if err := report.Write(cfg.ReportPath, vrep, arep); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "verify: wrote %s (ok=%v)\n", cfg.ReportPath, vrep.OK && arep.OK)
	if !vrep.OK || !arep.OK {
		return 1
	}
	return 0
}
