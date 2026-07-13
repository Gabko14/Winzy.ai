// Package goldenmaster implements Part 2 of winzy.ai-rdc7.12: sweep every
// user's every habit through the OLD and NEW APIs and diff flame/consistency
// values with zero tolerance.
package goldenmaster

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/jwtmint"
)

// TokenMode selects how the harness authenticates as existing users.
type TokenMode string

const (
	TokenModeJWT     TokenMode = "jwt"
	TokenModeXUserID TokenMode = "x-user-id"
)

// Config is the CLI-facing input for a golden-master run.
type Config struct {
	OldBaseURL  string
	NewBaseURL  string
	TokenMode   TokenMode
	JWTSecret   string
	DatabaseURL string
	UsersFile   string
	OwnerTZ     string
	ReportPath  string
	ArtifactDir string
	Log         io.Writer
}

// User is one account to sweep.
type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
}

// HabitRef is one habit from GET /habits.
type HabitRef struct {
	ID   string
	Name string
}

// Surface is one consistency observation.
type Surface string

const (
	SurfaceOwnerZurich Surface = "owner-stats-europe-zurich"
	SurfaceOwnerUTC    Surface = "owner-stats-utc"
	SurfacePublicUTC   Surface = "public-flame-utc"
)

// Row is one user × habit × surface comparison.
type Row struct {
	UserID     string   `json:"userId"`
	Username   string   `json:"username"`
	HabitID    string   `json:"habitId"`
	HabitName  string   `json:"habitName"`
	Surface    Surface  `json:"surface"`
	OldValue   *float64 `json:"oldValue"`
	NewValue   *float64 `json:"newValue"`
	Match      bool     `json:"match"`
	Skipped    bool     `json:"skipped,omitempty"`
	SkipReason string   `json:"skipReason,omitempty"`
	Error      string   `json:"error,omitempty"`
	OldStatus  int      `json:"oldStatus,omitempty"`
	NewStatus  int      `json:"newStatus,omitempty"`
	OldBody    any      `json:"oldBody,omitempty"`
	NewBody    any      `json:"newBody,omitempty"`
}

// Report is the on-disk JSON summary.
type Report struct {
	GeneratedAt time.Time `json:"generatedAt"`
	OldBaseURL  string    `json:"oldBaseUrl"`
	NewBaseURL  string    `json:"newBaseUrl"`
	TokenMode   string    `json:"tokenMode"`
	OwnerTZ     string    `json:"ownerTz"`
	Users       int       `json:"users"`
	Habits      int       `json:"habits"`
	Compared    int       `json:"compared"`
	Matched     int       `json:"matched"`
	Mismatched  int       `json:"mismatched"`
	Skipped     int       `json:"skipped"`
	Errors      int       `json:"errors"`
	AllMatch    bool      `json:"allMatch"`
	Rows        []Row     `json:"rows"`
}

type auth struct {
	headers map[string]string
	bearer  string
}

// Run executes the golden-master sweep against existing data only.
func Run(cfg Config) (Report, error) {
	if cfg.Log == nil {
		cfg.Log = os.Stdout
	}
	if cfg.OwnerTZ == "" {
		cfg.OwnerTZ = "Europe/Zurich"
	}
	if cfg.ArtifactDir == "" {
		cfg.ArtifactDir = "artifacts/golden-master"
	}
	if cfg.TokenMode == "" {
		cfg.TokenMode = TokenModeJWT
	}

	logf := func(format string, args ...any) {
		fmt.Fprintf(cfg.Log, "[%s] %s\n", time.Now().UTC().Format(time.RFC3339Nano), fmt.Sprintf(format, args...))
	}

	users, err := loadUsers(cfg)
	if err != nil {
		return Report{}, err
	}
	logf("golden-master start users=%d token_mode=%s old=%s new=%s", len(users), cfg.TokenMode, cfg.OldBaseURL, cfg.NewBaseURL)

	oldClient, err := httpclient.New(cfg.OldBaseURL, false)
	if err != nil {
		return Report{}, fmt.Errorf("goldenmaster: old client: %w", err)
	}
	newClient, err := httpclient.New(cfg.NewBaseURL, false)
	if err != nil {
		return Report{}, fmt.Errorf("goldenmaster: new client: %w", err)
	}
	_ = os.RemoveAll(cfg.ArtifactDir)

	rep := Report{
		GeneratedAt: time.Now().UTC(),
		OldBaseURL:  cfg.OldBaseURL,
		NewBaseURL:  cfg.NewBaseURL,
		TokenMode:   string(cfg.TokenMode),
		OwnerTZ:     cfg.OwnerTZ,
		Users:       len(users),
	}

	for _, u := range users {
		aOld, err := makeAuth(cfg, u)
		if err != nil {
			return Report{}, err
		}
		aNew, err := makeAuth(cfg, u)
		if err != nil {
			return Report{}, err
		}

		habits, err := listHabits(oldClient, aOld)
		if err != nil {
			logf("user=%s list-habits ERROR on old (%v) — trying new", u.Username, err)
			habits, err = listHabits(newClient, aNew)
			if err != nil {
				rep.Rows = append(rep.Rows, Row{UserID: u.ID, Username: u.Username, Error: fmt.Sprintf("list habits: %v", err)})
				rep.Errors++
				continue
			}
		}
		rep.Habits += len(habits)
		logf("user=%s habits=%d", u.Username, len(habits))

		publicOld, publicOldRes, errOld := fetchPublicMap(oldClient, u.Username)
		publicNew, publicNewRes, errNew := fetchPublicMap(newClient, u.Username)

		for _, h := range habits {
			for _, surface := range []Surface{SurfaceOwnerZurich, SurfaceOwnerUTC, SurfacePublicUTC} {
				row := Row{UserID: u.ID, Username: u.Username, HabitID: h.ID, HabitName: h.Name, Surface: surface}
				switch surface {
				case SurfaceOwnerZurich:
					row = fillStats(row, oldClient, newClient, aOld, aNew, h.ID, cfg.OwnerTZ)
				case SurfaceOwnerUTC:
					row = fillStats(row, oldClient, newClient, aOld, aNew, h.ID, "UTC")
				case SurfacePublicUTC:
					row = fillPublic(row, h.ID, publicOld, publicOldRes, errOld, publicNew, publicNewRes, errNew)
				}
				rep.Rows = append(rep.Rows, row)
				switch {
				case row.Error != "":
					rep.Errors++
					logf("MISMATCH/ERR user=%s habit=%s surface=%s err=%s", u.Username, h.ID, surface, row.Error)
					_ = writeMismatchArtifact(cfg.ArtifactDir, row)
				case row.Skipped:
					rep.Skipped++
				default:
					rep.Compared++
					if row.Match {
						rep.Matched++
					} else {
						rep.Mismatched++
						logf("MISMATCH user=%s habit=%s surface=%s old=%v new=%v", u.Username, h.ID, surface, deref(row.OldValue), deref(row.NewValue))
						_ = writeMismatchArtifact(cfg.ArtifactDir, row)
					}
				}
			}
		}
	}

	rep.AllMatch = rep.Mismatched == 0 && rep.Errors == 0
	printSummary(cfg.Log, rep)
	if cfg.ReportPath != "" {
		if err := writeReport(cfg.ReportPath, rep); err != nil {
			return rep, err
		}
		logf("report written path=%s", cfg.ReportPath)
	}
	return rep, nil
}

func makeAuth(cfg Config, u User) (auth, error) {
	switch cfg.TokenMode {
	case TokenModeJWT:
		if cfg.JWTSecret == "" {
			return auth{}, fmt.Errorf("goldenmaster: --jwt-secret required for token-mode=jwt")
		}
		tok, err := jwtmint.Mint(cfg.JWTSecret, u.ID, u.Email, time.Hour)
		if err != nil {
			return auth{}, err
		}
		return auth{bearer: tok}, nil
	case TokenModeXUserID:
		return auth{headers: map[string]string{"X-User-Id": u.ID}}, nil
	default:
		return auth{}, fmt.Errorf("goldenmaster: unknown token-mode %q (want jwt|x-user-id)", cfg.TokenMode)
	}
}

func loadUsers(cfg Config) ([]User, error) {
	if cfg.UsersFile != "" {
		b, err := os.ReadFile(cfg.UsersFile)
		if err != nil {
			return nil, fmt.Errorf("goldenmaster: read users file: %w", err)
		}
		var users []User
		if err := json.Unmarshal(b, &users); err != nil {
			return nil, fmt.Errorf("goldenmaster: parse users file: %w", err)
		}
		if len(users) == 0 {
			return nil, fmt.Errorf("goldenmaster: users file is empty")
		}
		return users, nil
	}
	if cfg.DatabaseURL != "" {
		return loadUsersFromPostgres(cfg.DatabaseURL)
	}
	return nil, fmt.Errorf("goldenmaster: provide --users-file or --database-url")
}

func loadUsersFromPostgres(databaseURL string) ([]User, error) {
	const q = `SELECT id::text, email, COALESCE(username, '') FROM users ORDER BY created_at, id`
	cmd := exec.Command("psql", databaseURL, "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", q)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("goldenmaster: psql user listing failed: %w\n%s\n(hint: install client psql or use --users-file; NEVER point at prod)", err, out)
	}
	var users []User
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 3 {
			return nil, fmt.Errorf("goldenmaster: unexpected psql row %q", line)
		}
		users = append(users, User{ID: parts[0], Email: parts[1], Username: parts[2]})
	}
	if len(users) == 0 {
		return nil, fmt.Errorf("goldenmaster: no users in database")
	}
	return users, nil
}

func listHabits(c *httpclient.Client, a auth) ([]HabitRef, error) {
	res, err := c.Do(httpclient.Request{Method: "GET", Path: "/habits", Bearer: a.bearer, Headers: a.headers})
	if err != nil {
		return nil, err
	}
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("GET /habits status %d body=%s", res.StatusCode, truncate(res.RawBody))
	}
	arr, ok := res.JSON.([]any)
	if !ok {
		return nil, fmt.Errorf("GET /habits: expected array, got %T", res.JSON)
	}
	out := make([]HabitRef, 0, len(arr))
	for _, it := range arr {
		m, _ := it.(map[string]any)
		out = append(out, HabitRef{ID: str(m, "id"), Name: str(m, "name")})
	}
	return out, nil
}

func fillStats(row Row, oldC, newC *httpclient.Client, aOld, aNew auth, habitID, tz string) Row {
	oldV, oldRes, oldErr := getConsistency(oldC, aOld, habitID, tz)
	newV, newRes, newErr := getConsistency(newC, aNew, habitID, tz)
	if oldRes != nil {
		row.OldStatus = oldRes.StatusCode
		row.OldBody = decodeBody(oldRes.RawBody)
	}
	if newRes != nil {
		row.NewStatus = newRes.StatusCode
		row.NewBody = decodeBody(newRes.RawBody)
	}
	if oldErr != nil || newErr != nil {
		row.Error = fmt.Sprintf("old=%v new=%v", oldErr, newErr)
		return row
	}
	row.OldValue = &oldV
	row.NewValue = &newV
	row.Match = oldV == newV
	return row
}

func getConsistency(c *httpclient.Client, a auth, habitID, tz string) (float64, *httpclient.Result, error) {
	res, err := c.Do(httpclient.Request{
		Method:  "GET",
		Path:    fmt.Sprintf("/habits/%s/stats", habitID),
		Bearer:  a.bearer,
		Headers: mergeHeaders(a.headers, map[string]string{"X-Timezone": tz}),
	})
	if err != nil {
		return 0, nil, err
	}
	if res.StatusCode != 200 {
		return 0, res, fmt.Errorf("status %d body=%s", res.StatusCode, truncate(res.RawBody))
	}
	m, _ := res.JSON.(map[string]any)
	v, ok := asFloat(m["consistency"])
	if !ok {
		return 0, res, fmt.Errorf("missing consistency in %v", m)
	}
	return v, res, nil
}

func fetchPublicMap(c *httpclient.Client, username string) (map[string]float64, *httpclient.Result, error) {
	res, err := c.Do(httpclient.Request{Method: "GET", Path: fmt.Sprintf("/habits/public/%s", username)})
	if err != nil {
		return nil, nil, err
	}
	if res.StatusCode == 404 {
		return nil, res, fmt.Errorf("not found")
	}
	if res.StatusCode != 200 {
		return nil, res, fmt.Errorf("status %d body=%s", res.StatusCode, truncate(res.RawBody))
	}
	m, _ := res.JSON.(map[string]any)
	habits, _ := m["habits"].([]any)
	out := make(map[string]float64, len(habits))
	for _, it := range habits {
		hm, _ := it.(map[string]any)
		id := str(hm, "id")
		if v, ok := asFloat(hm["consistency"]); ok {
			out[id] = v
		}
	}
	return out, res, nil
}

func fillPublic(row Row, habitID string, oldMap map[string]float64, oldRes *httpclient.Result, oldErr error, newMap map[string]float64, newRes *httpclient.Result, newErr error) Row {
	if oldRes != nil {
		row.OldStatus = oldRes.StatusCode
		row.OldBody = decodeBody(oldRes.RawBody)
	}
	if newRes != nil {
		row.NewStatus = newRes.StatusCode
		row.NewBody = decodeBody(newRes.RawBody)
	}
	if oldErr != nil && newErr != nil {
		row.Skipped = true
		row.SkipReason = "public flame page unavailable on both stacks (likely no public habits)"
		return row
	}
	if oldErr != nil || newErr != nil {
		row.Error = fmt.Sprintf("public old=%v new=%v", oldErr, newErr)
		return row
	}
	oldV, oldOK := oldMap[habitID]
	newV, newOK := newMap[habitID]
	if !oldOK && !newOK {
		row.Skipped = true
		row.SkipReason = "habit not present on public flame page (private/friends-only)"
		return row
	}
	if !oldOK || !newOK {
		row.Error = fmt.Sprintf("public presence mismatch oldOK=%v newOK=%v", oldOK, newOK)
		return row
	}
	row.OldValue = &oldV
	row.NewValue = &newV
	row.Match = oldV == newV
	return row
}

func decodeBody(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return string(b)
	}
	return v
}

func mergeHeaders(a, b map[string]string) map[string]string {
	out := make(map[string]string)
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

func str(m map[string]any, k string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[k].(string); ok {
		return v
	}
	return fmt.Sprint(m[k])
}

func asFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	default:
		return 0, false
	}
}

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func truncate(b []byte) string {
	s := string(b)
	if len(s) > 200 {
		return s[:200] + "…"
	}
	return s
}

func printSummary(w io.Writer, rep Report) {
	fmt.Fprintln(w, "")
	fmt.Fprintf(w, "=== GOLDEN-MASTER REPORT ===\n")
	fmt.Fprintf(w, "users=%d habits=%d compared=%d matched=%d mismatched=%d skipped=%d errors=%d all_match=%v\n",
		rep.Users, rep.Habits, rep.Compared, rep.Matched, rep.Mismatched, rep.Skipped, rep.Errors, rep.AllMatch)
	fmt.Fprintf(w, "--- per user × habit × surface ---\n")
	for _, r := range rep.Rows {
		status := "MATCH"
		switch {
		case r.Error != "":
			status = "ERROR"
		case r.Skipped:
			status = "SKIP"
		case !r.Match:
			status = "DIFF"
		}
		fmt.Fprintf(w, "  [%s] user=%s habit=%s(%s) surface=%s old=%v new=%v\n",
			status, r.Username, r.HabitName, r.HabitID, r.Surface, deref(r.OldValue), deref(r.NewValue))
		if r.Error != "" {
			fmt.Fprintf(w, "        error: %s\n", r.Error)
		}
		if r.SkipReason != "" {
			fmt.Fprintf(w, "        skip: %s\n", r.SkipReason)
		}
	}
}

func writeReport(path string, rep Report) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
		return err
	}
	b, err := json.MarshalIndent(rep, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func writeMismatchArtifact(dir string, row Row) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	name := fmt.Sprintf("%s_%s_%s.json", sanitize(row.Username), sanitize(row.HabitID), sanitize(string(row.Surface)))
	b, err := json.MarshalIndent(row, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, name), b, 0o644)
}

func sanitize(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	return b.String()
}
