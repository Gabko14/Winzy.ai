// Command parity is the one-command entry point for the dual-stack parity
// harness (winzy.ai-rdc7.12). Phase 1 captured goldens from the live old
// .NET stack. Phase 2 points check at the Go stack and diffs against those
// goldens, with a reviewed allowlist for intentional divergences:
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
// Both subcommands print an auditable report (scenario names + request
// counts + pass/fail) and write failure artifacts under artifacts/.
package main

import (
	"flag"
	"fmt"
	"os"

	"winzy.ai/parity/internal/allowlist"
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
	case "-h", "--help", "help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand %q\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `usage: parity <capture|check> [flags]

  capture --base-url URL [--stack NAME] [--goldens DIR] [--artifacts DIR]
      Run every scenario against URL and store canonicalized responses as
      the golden master.

  check --base-url URL [--stack NAME] [--goldens DIR] [--artifacts DIR] [--allowlist FILE]
      Run every scenario against URL and diff against the stored golden
      master. Exit code is non-zero if any scenario has unexplained diffs.
      --allowlist defaults to allowlist.json (approved response-surface
      entries only; seeded candidates never auto-pass).`)
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
