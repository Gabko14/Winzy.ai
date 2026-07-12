// Package runner is the scenario execution engine: it drives HTTP calls
// through httpclient, canonicalizes responses through normalize, and
// implements the two run modes required by winzy.ai-rdc7.12 phase 1:
//
//   - ModeCapture: record canonicalized responses as goldens.
//   - ModeCheck: replay scenarios against a (possibly different) base URL
//     and diff canonicalized responses against stored goldens.
//
// Both modes share the same observability contract from the PM's review
// addendum: every step is logged with a timestamp and the stack-under-test
// label, and any diff (or unexpected status code, or transport error)
// dumps the full request and response(s) into an artifacts directory as
// one JSON file per failure, so a red run is diagnosable and a green run's
// log makes it obvious what was actually covered.
package runner

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"winzy.ai/parity/internal/allowlist"
	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/idmap"
	"winzy.ai/parity/internal/normalize"
)

type Mode int

const (
	ModeCapture Mode = iota
	ModeCheck
)

func (m Mode) String() string {
	if m == ModeCapture {
		return "capture"
	}
	return "check"
}

// Scenario is one named, self-contained flow. Run receives a fresh
// *Context scoped to this scenario and returns an error to mark it failed
// (the runner does not abort the whole suite — it moves on to the next
// scenario so a single broken flow doesn't hide coverage of everything
// else).
type Scenario struct {
	Name string
	Run  func(ctx *Context) error
}

// Suite runs a list of scenarios and produces the final auditable report.
type Suite struct {
	Mode        Mode
	BaseURL     string
	Stack       string // free-text label for logs/artifacts, e.g. "old" or "go"
	GoldenDir   string
	ArtifactDir string
	Allowlist   *allowlist.List // optional; only approved response-surface entries suppress diffs
	Log         io.Writer
}

type scenarioResult struct {
	Name             string
	Pass             bool
	RequestCount     int
	Failures         []string
	AllowlistedDiffs int
	Duration         time.Duration
}

// Report is the final pass/fail summary, printed and also returned so
// callers (e.g. the CLI's exit-code logic) can act on it.
type Report struct {
	Mode                  Mode
	Stack                 string
	Results               []scenarioResult
	TotalRequests         int
	TotalAllowlistedDiffs int
}

func (r Report) AllPassed() bool {
	for _, res := range r.Results {
		if !res.Pass {
			return false
		}
	}
	return true
}

func (s *Suite) Run(scenarios []Scenario) (Report, error) {
	logger := log(s.Log)
	report := Report{Mode: s.Mode, Stack: s.Stack}

	for _, sc := range scenarios {
		ids := idmap.New()
		ctx := &Context{
			mode:        s.Mode,
			baseURL:     s.BaseURL,
			stack:       s.Stack,
			scenario:    sc.Name,
			goldenDir:   filepath.Join(s.GoldenDir, sanitize(sc.Name)),
			artifactDir: filepath.Join(s.ArtifactDir, sanitize(sc.Name)),
			allowlist:   s.Allowlist,
			IDs:         ids,
			log:         logger,
		}

		native, err := httpclient.New(s.BaseURL, false)
		if err != nil {
			return report, fmt.Errorf("runner: building native client: %w", err)
		}
		web, err := httpclient.New(s.BaseURL, true)
		if err != nil {
			return report, fmt.Errorf("runner: building web client: %w", err)
		}
		ctx.Native = native
		ctx.Web = web

		// Artifacts are ephemeral per-run diagnostics — always start clean so
		// a fixed failure from a previous run doesn't linger and mislead.
		// Goldens are only reset in capture mode: if a scenario's step
		// names/order changed since the last capture, stale files from the
		// old shape would otherwise sit alongside the new ones forever
		// (check mode must never touch the golden master it's diffing
		// against).
		_ = os.RemoveAll(ctx.artifactDir)
		if s.Mode == ModeCapture {
			_ = os.RemoveAll(ctx.goldenDir)
		}

		logger(fmt.Sprintf("=== scenario start name=%q stack=%s mode=%s", sc.Name, s.Stack, s.Mode))
		start := time.Now()
		runErr := sc.Run(ctx)
		dur := time.Since(start)

		res := scenarioResult{
			Name:             sc.Name,
			Pass:             runErr == nil && len(ctx.failures) == 0,
			RequestCount:     ctx.requestCount,
			Failures:         ctx.failures,
			AllowlistedDiffs: ctx.allowlistedDiffs,
			Duration:         dur,
		}
		if runErr != nil {
			res.Pass = false
			res.Failures = append(res.Failures, runErr.Error())
		}
		report.Results = append(report.Results, res)
		report.TotalRequests += ctx.requestCount
		report.TotalAllowlistedDiffs += ctx.allowlistedDiffs

		status := "PASS"
		if !res.Pass {
			status = "FAIL"
		}
		logger(fmt.Sprintf("=== scenario end   name=%q status=%s requests=%d allowlisted_diffs=%d duration=%s",
			sc.Name, status, ctx.requestCount, ctx.allowlistedDiffs, dur))
	}

	printReport(logger, report)
	return report, nil
}

func printReport(logger func(string), r Report) {
	logger("")
	logger(fmt.Sprintf("=== PARITY REPORT (mode=%s stack=%s) ===", r.Mode, r.Stack))
	passCount := 0
	for _, res := range r.Results {
		status := "PASS"
		if !res.Pass {
			status = "FAIL"
		} else {
			passCount++
		}
		logger(fmt.Sprintf("  [%s] %-40s requests=%-4d allowlisted_diffs=%-3d duration=%s",
			status, res.Name, res.RequestCount, res.AllowlistedDiffs, res.Duration.Round(time.Millisecond)))
		for _, f := range res.Failures {
			logger(fmt.Sprintf("        - %s", f))
		}
	}
	logger(fmt.Sprintf("--- %d/%d scenarios passed, %d total requests, %d allowlisted diffs ---",
		passCount, len(r.Results), r.TotalRequests, r.TotalAllowlistedDiffs))
}

func log(w io.Writer) func(string) {
	return func(msg string) {
		fmt.Fprintf(w, "[%s] %s\n", time.Now().UTC().Format(time.RFC3339Nano), msg)
	}
}

var nonAlnum = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

func sanitize(name string) string {
	return nonAlnum.ReplaceAllString(strings.ToLower(strings.ReplaceAll(name, " ", "-")), "-")
}

// Context is handed to each scenario. It exposes both a native and a web
// HTTP identity (see package httpclient), the shared id-mapping table for
// this scenario run, and the Call method that performs the observability +
// golden-capture/check bookkeeping.
type Context struct {
	Native *httpclient.Client
	Web    *httpclient.Client
	IDs    *idmap.Map

	mode        Mode
	baseURL     string
	stack       string
	scenario    string
	goldenDir   string
	artifactDir string
	allowlist   *allowlist.List
	log         func(string)

	stepIdx          int
	requestCount     int
	allowlistedDiffs int
	failures         []string
}

// goldenEnvelope is the on-disk shape of one captured step.
type goldenEnvelope struct {
	Status int `json:"status"`
	Body   any `json:"body"`
}

// Call executes one HTTP step: it logs the step, performs the request,
// checks the status code against expectStatus (if any are given — an empty
// list means "don't assert, just record"), and then either writes a golden
// (capture mode) or diffs against the stored golden (check mode). Any
// mismatch is written to the artifact directory and recorded as a scenario
// failure; Call still returns the raw Result so the scenario can keep
// extracting fields from it to chain subsequent steps.
func (c *Context) Call(client *httpclient.Client, step string, req httpclient.Request, expectStatus ...int) (*httpclient.Result, error) {
	c.stepIdx++
	stepStart := time.Now().UTC()

	result, err := client.Do(req)
	c.requestCount++
	if err != nil {
		c.log(fmt.Sprintf("[%s] stack=%s scenario=%q step=%02d name=%q method=%s path=%s ERROR=%v",
			stepStart.Format(time.RFC3339Nano), c.stack, c.scenario, c.stepIdx, step, req.Method, req.Path, err))
		c.writeArtifact(step, req, nil, nil, nil, []string{fmt.Sprintf("transport error: %v", err)})
		c.fail(fmt.Sprintf("step %02d (%s): transport error: %v", c.stepIdx, step, err))
		return nil, err
	}

	c.log(fmt.Sprintf("[%s] stack=%s scenario=%q step=%02d name=%q method=%s path=%s status=%d duration=%s",
		stepStart.Format(time.RFC3339Nano), c.stack, c.scenario, c.stepIdx, step, req.Method, req.Path, result.StatusCode, result.Duration.Round(time.Millisecond)))

	if len(expectStatus) > 0 && !contains(expectStatus, result.StatusCode) {
		diffs := []string{fmt.Sprintf("unexpected status: got %d, want one of %v", result.StatusCode, expectStatus)}
		c.writeArtifact(step, req, result, nil, nil, diffs)
		c.fail(fmt.Sprintf("step %02d (%s): unexpected status %d (want %v)", c.stepIdx, step, result.StatusCode, expectStatus))
		return result, fmt.Errorf("step %q: unexpected status %d", step, result.StatusCode)
	}

	canonical, cerr := normalize.Canonicalize(result.RawBody, c.IDs)
	if cerr != nil {
		// Non-JSON bodies (flame.svg) are expected for some steps; only
		// treat this as fatal if the body was non-empty and looked like it
		// was supposed to be JSON (content-type based).
		if strings.Contains(result.Header.Get("Content-Type"), "json") {
			c.writeArtifact(step, req, result, nil, nil, []string{cerr.Error()})
			c.fail(fmt.Sprintf("step %02d (%s): %v", c.stepIdx, step, cerr))
			return result, cerr
		}
		return result, nil
	}

	goldenPath := c.goldenPath(step)
	switch c.mode {
	case ModeCapture:
		if err := c.writeGolden(goldenPath, goldenEnvelope{Status: result.StatusCode, Body: canonical}); err != nil {
			return result, fmt.Errorf("writing golden: %w", err)
		}
	case ModeCheck:
		existing, err := c.readGolden(goldenPath)
		if err != nil {
			diffs := []string{fmt.Sprintf("no golden found at %s: %v", goldenPath, err)}
			c.writeArtifact(step, req, result, nil, nil, diffs)
			c.fail(fmt.Sprintf("step %02d (%s): %s", c.stepIdx, step, diffs[0]))
			return result, fmt.Errorf("missing golden for step %q", step)
		}
		var diffs []string
		if existing.Status != result.StatusCode {
			diffs = append(diffs, fmt.Sprintf("status: golden=%d actual=%d", existing.Status, result.StatusCode))
		}
		// Civil dates in goldens are capture-day literals; mask both sides
		// so relative "today"/"today±N" scenarios don't fail solely because
		// the check ran on a later calendar day than the golden capture.
		// Feed items with tied createdAt get a stable secondary sort so
		// friend.accept actor-order flips don't fail the diff (F6a).
		goldenBody := normalize.StableSortFeedItems(normalize.MaskCivilDates(existing.Body))
		actualBody := normalize.StableSortFeedItems(normalize.MaskCivilDates(canonical))
		diffs = append(diffs, normalize.Diff("$", goldenBody, actualBody)...)
		filtered := allowlist.Result{Unexplained: diffs}
		if c.allowlist != nil {
			filtered = c.allowlist.Filter(c.scenario, diffs)
		}
		for _, m := range filtered.Allowlisted {
			c.allowlistedDiffs++
			c.log(fmt.Sprintf("    ALLOWLISTED scenario=%q step=%q id=%s source=%s diff=%s",
				c.scenario, step, m.Entry.ID, m.Entry.SourceBead, m.Diff))
		}
		if len(filtered.Unexplained) > 0 {
			c.writeArtifact(step, req, result, nil, existing.Body, filtered.Unexplained)
			c.fail(fmt.Sprintf("step %02d (%s): %d unexplained diff(s) vs golden (%d allowlisted)",
				c.stepIdx, step, len(filtered.Unexplained), len(filtered.Allowlisted)))
			return result, fmt.Errorf("step %q: diverges from golden", step)
		}
	}

	return result, nil
}

// Fail lets a scenario report a semantic assertion failure that isn't a
// simple "wrong status code" (e.g. "expected field X to be null but got
// non-null"), routed through the same observability path.
func (c *Context) Fail(step string, req httpclient.Request, result *httpclient.Result, reason string) {
	c.writeArtifact(step, req, result, nil, nil, []string{reason})
	c.fail(fmt.Sprintf("step (%s): %s", step, reason))
}

// Note writes an informational line to the run log without affecting
// pass/fail — for observations that are worth surfacing in an auditable
// run but aren't a scenario assertion failure (e.g. "this run happened not
// to exercise a time-of-day-dependent edge case").
func (c *Context) Note(msg string) {
	c.log(fmt.Sprintf("    NOTE scenario=%q: %s", c.scenario, msg))
}

func (c *Context) fail(msg string) {
	c.failures = append(c.failures, msg)
}

func contains(xs []int, v int) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

func (c *Context) goldenPath(step string) string {
	return filepath.Join(c.goldenDir, fmt.Sprintf("%02d_%s.json", c.stepIdx, sanitize(step)))
}

func (c *Context) writeGolden(path string, env goldenEnvelope) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func (c *Context) readGolden(path string) (goldenEnvelope, error) {
	var env goldenEnvelope
	b, err := os.ReadFile(path)
	if err != nil {
		return env, err
	}
	if err := json.Unmarshal(b, &env); err != nil {
		return env, err
	}
	return env, nil
}

// artifactRecord is the on-disk shape of a failure artifact: the full
// request and response(s) so a red run is diagnosable without re-running
// anything.
type artifactRecord struct {
	Timestamp  time.Time `json:"timestamp"`
	Scenario   string    `json:"scenario"`
	Stack      string    `json:"stack"`
	Step       string    `json:"step"`
	Request    any       `json:"request"`
	Response   any       `json:"response,omitempty"`
	GoldenBody any       `json:"goldenBody,omitempty"`
	Diffs      []string  `json:"diffs"`
}

func (c *Context) writeArtifact(step string, req httpclient.Request, result *httpclient.Result, extraReqBody []byte, goldenBody any, diffs []string) {
	dir := c.artifactDir
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	path := filepath.Join(dir, fmt.Sprintf("%02d_%s.json", c.stepIdx, sanitize(step)))

	reqRecord := map[string]any{
		"method":        req.Method,
		"path":          req.Path,
		"query":         req.Query,
		"headers":       redactHeaders(req.Headers),
		"bearerPresent": req.Bearer != "",
		"body":          rawJSONOrNil(reqBodyBytes(req)),
	}

	var respRecord any
	if result != nil {
		respRecord = map[string]any{
			"status":  result.StatusCode,
			"headers": redactRespHeaders(result.Header),
			"body":    rawJSONOrString(result.RawBody),
		}
	}

	rec := artifactRecord{
		Timestamp:  time.Now().UTC(),
		Scenario:   c.scenario,
		Stack:      c.stack,
		Step:       step,
		Request:    reqRecord,
		Response:   respRecord,
		GoldenBody: goldenBody,
		Diffs:      diffs,
	}
	b, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, b, 0o644)
	c.log(fmt.Sprintf("    -> FAILURE ARTIFACT written: %s", path))
}

func reqBodyBytes(req httpclient.Request) []byte {
	if req.Body == nil {
		return nil
	}
	b, _ := json.Marshal(req.Body)
	return b
}

func rawJSONOrNil(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return string(b)
	}
	return v
}

func rawJSONOrString(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return string(b)
	}
	return v
}

func redactHeaders(h map[string]string) map[string]string {
	out := make(map[string]string, len(h))
	for k, v := range h {
		if strings.EqualFold(k, "authorization") || strings.EqualFold(k, "cookie") {
			out[k] = "{{redacted}}"
			continue
		}
		out[k] = v
	}
	return out
}

func redactRespHeaders(h map[string][]string) map[string][]string {
	out := make(map[string][]string, len(h))
	for k, v := range h {
		if strings.EqualFold(k, "set-cookie") {
			out[k] = []string{"{{redacted}}"}
			continue
		}
		out[k] = v
	}
	return out
}
