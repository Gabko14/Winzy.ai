// Command testtiming reads `go test -json` on stdin and prints a per-package
// duration table. Soft tripwire: when wall-clock exceeds -warn-after, emit a
// GitHub Actions warning annotation (does not fail the process).
//
// winzy.ai-56ki close-out of the test-speed epic (winzy.ai-s8ly). Phase C
// (in-package t.Parallel / zfa3) is deferred — warn threshold is ~3x the
// measured Phase A+B parallel steady state (~13s → 40s), not the stale 120s.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"time"
)

type testEvent struct {
	Time    time.Time
	Action  string
	Package string
	Test    string
	Elapsed float64 // seconds; set on package-level pass/fail/skip
}

type pkgResult struct {
	Package string
	Action  string
	Elapsed float64
}

func main() {
	warnAfter := flag.Duration("warn-after", 40*time.Second,
		"soft tripwire: warn (do not fail) when wall-clock exceeds this")
	flag.Parse()

	results, wall, err := summarize(os.Stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "testtiming: %v\n", err)
		os.Exit(2)
	}
	printTable(os.Stdout, results, wall)
	if wall > *warnAfter {
		// Soft tripwire only — exit 0 so CI stays green; drift is visible.
		msg := fmt.Sprintf(
			"integration suite wall-clock %.1fs exceeds soft tripwire %s (Phase A+B steady state ~13s; threshold ~3x). Investigate before it hurts.",
			wall.Seconds(), warnAfter.String())
		fmt.Fprintf(os.Stdout, "::warning title=go-test-timing-tripwire::%s\n", msg)
		fmt.Fprintf(os.Stderr, "testtiming: WARN %s\n", msg)
	}
}

func summarize(r io.Reader) ([]pkgResult, time.Duration, error) {
	var (
		results   []pkgResult
		firstTime time.Time
		lastTime  time.Time
		haveTime  bool
	)
	sc := bufio.NewScanner(r)
	// go test -json lines can be long under -race; raise the limit.
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 || line[0] != '{' {
			continue
		}
		var ev testEvent
		if err := json.Unmarshal(line, &ev); err != nil {
			continue
		}
		if !ev.Time.IsZero() {
			if !haveTime {
				firstTime = ev.Time
				haveTime = true
			}
			lastTime = ev.Time
		}
		if ev.Package == "" || ev.Test != "" {
			continue
		}
		switch ev.Action {
		case "pass", "fail", "skip":
			results = append(results, pkgResult{
				Package: ev.Package,
				Action:  ev.Action,
				Elapsed: ev.Elapsed,
			})
		}
	}
	if err := sc.Err(); err != nil {
		return nil, 0, err
	}
	sort.Slice(results, func(i, j int) bool {
		if results[i].Elapsed == results[j].Elapsed {
			return results[i].Package < results[j].Package
		}
		return results[i].Elapsed > results[j].Elapsed
	})
	var wall time.Duration
	if haveTime && !lastTime.Before(firstTime) {
		wall = lastTime.Sub(firstTime)
	}
	return results, wall, nil
}

func printTable(w io.Writer, results []pkgResult, wall time.Duration) {
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "=== go test timing (per package, slowest first) ===")
	fmt.Fprintf(w, "%-8s  %8s  %s\n", "STATUS", "SECONDS", "PACKAGE")
	for _, r := range results {
		fmt.Fprintf(w, "%-8s  %8.2f  %s\n", strings.ToUpper(r.Action), r.Elapsed, shortPkg(r.Package))
	}
	fmt.Fprintf(w, "WALL      %8.2f  (first→last JSON event)\n", wall.Seconds())
	fmt.Fprintln(w, "=== end go test timing ===")
}

func shortPkg(importPath string) string {
	// github.com/Gabko14/winzy/backend/internal/auth → internal/auth
	const marker = "/backend/"
	if i := strings.Index(importPath, marker); i >= 0 {
		return importPath[i+len(marker):]
	}
	return path.Base(importPath)
}
