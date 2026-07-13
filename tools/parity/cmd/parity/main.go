// Command parity is the one-command entry point for the dual-stack parity
// harness (winzy.ai-rdc7.12). Phase 1 captured goldens from the live old
// .NET stack. Phase 2 points check at the Go stack and diffs against those
// goldens, with a reviewed allowlist for intentional divergences.
// Part 2 (flame golden-master) sweeps existing migrated data through OLD
// and NEW APIs and diffs consistency values with zero tolerance:
//
//	parity capture --base-url http://localhost:5050 --stack old
//		Runs every scenario against the given stack and stores canonicalized
//		responses under goldens/ as the golden master.
//
//	parity check --base-url http://localhost:5051 --stack go
//		Runs every scenario fresh against the Go stack and diffs
//		canonicalized responses against the stored goldens. Approved
//		response-surface allowlist entries suppress known intentional diffs;
//		anything else fails the run.
//
//	parity golden-master --old-base-url URL --new-base-url URL --report FILE
//		Authenticates as existing users (JWT mint or X-User-Id) and sweeps
//		every habit's consistency through both stacks. No scenario seeding.
package main

import (
	"flag"
	"fmt"
	"os"

	"winzy.ai/parity/internal/allowlist"
	"winzy.ai/parity/internal/goldenmaster"
	"winzy.ai/parity/internal/runner"
	"winzy.ai/parity/internal/scenarios"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "capture":
		run(runner.ModeCapture, os.Args[2:])
	case "check":
		run(runner.ModeCheck, os.Args[2:])
	case "golden-master":
		runGoldenMaster(os.Args[2:])
	case "-h", "--help", "help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand %q\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `usage: parity <capture|check|golden-master> [flags]

  capture --base-url URL [--stack NAME] [--goldens DIR] [--artifacts DIR]
      Run every scenario against URL and store canonicalized responses as
      the golden master.

  check --base-url URL [--stack NAME] [--goldens DIR] [--artifacts DIR] [--allowlist FILE]
      Run every scenario against URL and diff against the stored golden
      master. Exit code is non-zero if any scenario has unexplained diffs.
      --allowlist defaults to allowlist.json (approved response-surface
      entries only; seeded candidates never auto-pass).

  golden-master --old-base-url URL --new-base-url URL --report FILE
      [--token-mode jwt|x-user-id] [--jwt-secret SECRET]
      [--database-url URL | --users-file FILE] [--owner-tz TZ]
      [--artifacts DIR]
      Sweep every existing user's every habit through OLD and NEW APIs and
      compare consistency EXACTLY (owner-tz stats, UTC stats, public flame).
      Does NOT seed users. LOCAL DEV ONLY — never point --database-url /
      --jwt-secret at production.`)
}

func run(mode runner.Mode, args []string) {
	fs := flag.NewFlagSet(mode.String(), flag.ExitOnError)
	baseURL := fs.String("base-url", "http://localhost:5050", "base URL of the stack under test")
	stack := fs.String("stack", "old", "free-text label for the stack under test, e.g. old|go")
	goldensDir := fs.String("goldens", "goldens", "directory holding golden captures")
	artifactsDir := fs.String("artifacts", "artifacts", "directory to write failure artifacts into")
	allowlistPath := fs.String("allowlist", "allowlist.json", "reviewed intentional-diff allowlist (check mode; empty disables)")
	only := fs.String("only", "", "comma-separated substring filter on scenario names (empty = run all)")
	_ = fs.Parse(args)

	var al *allowlist.List
	if mode == runner.ModeCheck && *allowlistPath != "" {
		loaded, err := allowlist.Load(*allowlistPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "parity: allowlist: %v\n", err)
			os.Exit(1)
		}
		al = loaded
		fmt.Fprintf(os.Stdout, "allowlist: loaded %s (%d seeded, %d approved)\n",
			loaded.Path(), len(loaded.Seeded()), len(loaded.Approved()))
	}

	all := scenarios.All()
	list := all
	if *only != "" {
		list = filterScenarios(all, *only)
	}

	suite := &runner.Suite{
		Mode:        mode,
		BaseURL:     *baseURL,
		Stack:       *stack,
		GoldenDir:   *goldensDir,
		ArtifactDir: *artifactsDir,
		Allowlist:   al,
		Log:         os.Stdout,
	}

	report, err := suite.Run(list)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parity: fatal: %v\n", err)
		os.Exit(1)
	}

	if !report.AllPassed() {
		os.Exit(1)
	}
}

func runGoldenMaster(args []string) {
	fs := flag.NewFlagSet("golden-master", flag.ExitOnError)
	oldBase := fs.String("old-base-url", "", "OLD stack base URL (required), e.g. http://localhost:5050")
	newBase := fs.String("new-base-url", "", "NEW stack base URL (required), e.g. http://localhost:5051")
	reportPath := fs.String("report", "artifacts/golden-master/report.json", "JSON report output path")
	tokenMode := fs.String("token-mode", "jwt", "auth strategy: jwt (mint HS256) or x-user-id")
	jwtSecret := fs.String("jwt-secret", "", "HS256 secret shared by both local stacks (jwt mode; LOCAL DEV ONLY)")
	databaseURL := fs.String("database-url", "", "Postgres URL to list users via psql (LOCAL DEV ONLY; never prod)")
	usersFile := fs.String("users-file", "", "JSON array of {id,email,username} (alternative to --database-url)")
	ownerTZ := fs.String("owner-tz", "Europe/Zurich", "X-Timezone for the owner-stats surface")
	artifactsDir := fs.String("artifacts", "artifacts/golden-master", "directory for mismatch artifacts")
	_ = fs.Parse(args)

	if *oldBase == "" || *newBase == "" {
		fmt.Fprintln(os.Stderr, "parity golden-master: --old-base-url and --new-base-url are required")
		fs.Usage()
		os.Exit(2)
	}
	if *usersFile == "" && *databaseURL == "" {
		fmt.Fprintln(os.Stderr, "parity golden-master: provide --users-file or --database-url")
		fs.Usage()
		os.Exit(2)
	}
	if *tokenMode == "jwt" && *jwtSecret == "" {
		fmt.Fprintln(os.Stderr, "parity golden-master: --jwt-secret required when --token-mode=jwt")
		fs.Usage()
		os.Exit(2)
	}

	rep, err := goldenmaster.Run(goldenmaster.Config{
		OldBaseURL:  *oldBase,
		NewBaseURL:  *newBase,
		TokenMode:   goldenmaster.TokenMode(*tokenMode),
		JWTSecret:   *jwtSecret,
		DatabaseURL: *databaseURL,
		UsersFile:   *usersFile,
		OwnerTZ:     *ownerTZ,
		ReportPath:  *reportPath,
		ArtifactDir: *artifactsDir,
		Log:         os.Stdout,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "parity golden-master: fatal: %v\n", err)
		os.Exit(1)
	}
	if !rep.AllMatch {
		os.Exit(1)
	}
}

func filterScenarios(all []runner.Scenario, filter string) []runner.Scenario {
	var out []runner.Scenario
	for _, s := range all {
		if contains(s.Name, filter) {
			out = append(out, s)
		}
	}
	return out
}

func contains(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
