package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const (
	// Dedicated postgres:18 rehearsal instance (winzy-mig-db). Do NOT use
	// winzy-db (:5439) — that lane stays PG17 for integration tests.
	DefaultAdminURL = "postgres://winzy:winzy@localhost:5440/postgres?sslmode=disable"
	DefaultHost     = "localhost"
	DefaultPort     = "5440"
	DefaultUser     = "winzy"
	DefaultPassword = "winzy"
	DefaultSSLMode  = "disable"

	TargetDB = "winzy_rehearsal"

	// ForbiddenDBs must never be created, dropped, truncated, or restored into
	// (and must not exist on this dedicated mig instance anyway).
	ForbiddenWinzy       = "winzy"
	ForbiddenWinzyParity = "winzy_parity"
)

// SourceServices are the six per-service dumps → logical source DBs.
var SourceServices = []SourceService{
	{Name: "auth", DumpFile: "auth-db.dump", DB: "winzy_mig_src_auth"},
	{Name: "habit", DumpFile: "habit-db.dump", DB: "winzy_mig_src_habit"},
	{Name: "social", DumpFile: "social-db.dump", DB: "winzy_mig_src_social"},
	{Name: "challenge", DumpFile: "challenge-db.dump", DB: "winzy_mig_src_challenge"},
	{Name: "notification", DumpFile: "notification-db.dump", DB: "winzy_mig_src_notification"},
	{Name: "activity", DumpFile: "activity-db.dump", DB: "winzy_mig_src_activity"},
}

type SourceService struct {
	Name     string
	DumpFile string
	DB       string
}

// LoadExpectedCounts reads source-row-counts.txt from the archive dir —
// the row counts recorded at dump time are the baseline the restored
// sources must match. Counts come from pg_stat n_live_tup, which is an
// ESTIMATE: exact for quiet tables (everything we migrate) but can drift
// slightly on high-churn ones (refresh_tokens) — the caller decides how
// strictly to compare. Lines are "table=count" grouped under "-- <svc>"
// headers; __EFMigrationsHistory is dump bookkeeping, not app data.
func LoadExpectedCounts(archiveDir string) (map[string]int, error) {
	raw, err := os.ReadFile(filepath.Join(archiveDir, "source-row-counts.txt"))
	if err != nil {
		return nil, fmt.Errorf("config: expected counts: %w", err)
	}
	counts := map[string]int{}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		name, val, ok := strings.Cut(line, "=")
		if !ok || name == "__EFMigrationsHistory" {
			continue
		}
		n := 0
		if _, err := fmt.Sscanf(val, "%d", &n); err != nil {
			return nil, fmt.Errorf("config: expected counts: bad line %q: %w", line, err)
		}
		counts[name] = n
	}
	if len(counts) == 0 {
		return nil, fmt.Errorf("config: expected counts: no table counts in %s", archiveDir)
	}
	return counts, nil
}

// Config holds CLI-resolved paths and connection settings.
type Config struct {
	ArchiveDir string
	AdminURL   string
	Host       string
	Port       string
	User       string
	Password   string
	SSLMode    string
	// TargetDBName is the composed target database name when TargetURLOverride
	// is empty. Defaults to TargetDB (winzy_rehearsal).
	TargetDBName string
	// TargetURLOverride, when set (via --target-url), wins over host/port/user/
	// TargetDBName/sslmode composition for TargetURL().
	TargetURLOverride string
	ReportPath        string
	DockerImage       string
}

func Default() Config {
	return Config{
		AdminURL:     DefaultAdminURL,
		Host:         DefaultHost,
		Port:         DefaultPort,
		User:         DefaultUser,
		Password:     DefaultPassword,
		SSLMode:      DefaultSSLMode,
		TargetDBName: TargetDB,
		DockerImage:  "postgres:18-alpine",
		ReportPath:   "verification-report.md",
	}
}

func (c Config) sslMode() string {
	if c.SSLMode == "" {
		return DefaultSSLMode
	}
	return c.SSLMode
}

func (c Config) composedTargetDB() string {
	if c.TargetDBName == "" {
		return TargetDB
	}
	return c.TargetDBName
}

func (c Config) SourceURL(db string) string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		c.User, c.Password, c.Host, c.Port, db, c.sslMode())
}

// TargetURL returns the postgres URL for the rehearsal/cutover target.
// --target-url (TargetURLOverride) wins over composed host/port/user/db/sslmode.
func (c Config) TargetURL() string {
	if c.TargetURLOverride != "" {
		return c.TargetURLOverride
	}
	return c.SourceURL(c.composedTargetDB())
}

// EffectiveTargetDB returns the database name the tool will create/load into,
// parsed from --target-url when set, otherwise from --target-db / default.
// Refuses unparseable URLs and forbidden names (winzy, winzy_parity).
func (c Config) EffectiveTargetDB() (string, error) {
	var name string
	if c.TargetURLOverride != "" {
		parsed, err := DatabaseNameFromURL(c.TargetURLOverride)
		if err != nil {
			return "", err
		}
		name = parsed
	} else {
		name = c.composedTargetDB()
	}
	if err := AssertNotForbidden(name); err != nil {
		return "", err
	}
	return name, nil
}

// ValidateTarget ensures TargetURL() is usable for restore/load/schema/verify.
func (c Config) ValidateTarget() error {
	if _, err := c.EffectiveTargetDB(); err != nil {
		return err
	}
	if c.TargetURLOverride != "" {
		if _, err := url.Parse(c.TargetURLOverride); err != nil {
			return fmt.Errorf("config: cannot parse --target-url: %w", err)
		}
	}
	return nil
}

// DatabaseNameFromURL extracts the database name from a postgres URL.
func DatabaseNameFromURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("config: cannot parse target URL: %w", err)
	}
	switch u.Scheme {
	case "postgres", "postgresql":
	default:
		return "", fmt.Errorf("config: target URL scheme %q is not postgres/postgresql", u.Scheme)
	}
	if u.Host == "" {
		return "", fmt.Errorf("config: target URL missing host")
	}
	name := strings.Trim(u.Path, "/")
	if name == "" || strings.Contains(name, "/") {
		return "", fmt.Errorf("config: target URL missing database name (path empty)")
	}
	return name, nil
}

func (c Config) DumpPath(svc SourceService) string {
	return filepath.Join(c.ArchiveDir, svc.DumpFile)
}

func (c Config) ValidateArchive() error {
	if c.ArchiveDir == "" {
		return fmt.Errorf("config: --archive is required")
	}
	st, err := os.Stat(c.ArchiveDir)
	if err != nil {
		return fmt.Errorf("config: archive %q: %w", c.ArchiveDir, err)
	}
	if !st.IsDir() {
		return fmt.Errorf("config: archive %q is not a directory", c.ArchiveDir)
	}
	for _, svc := range SourceServices {
		p := c.DumpPath(svc)
		if _, err := os.Stat(p); err != nil {
			return fmt.Errorf("config: missing dump %s: %w", p, err)
		}
	}
	counts := filepath.Join(c.ArchiveDir, "source-row-counts.txt")
	if _, err := os.Stat(counts); err != nil {
		return fmt.Errorf("config: missing source-row-counts.txt: %w", err)
	}
	return nil
}

func AssertNotForbidden(db string) error {
	name := strings.ToLower(strings.TrimSpace(db))
	if name == ForbiddenWinzy || name == ForbiddenWinzyParity {
		return fmt.Errorf("refusing to touch forbidden database %q", db)
	}
	return nil
}

func AllManagedDBs() []string {
	out := make([]string, 0, len(SourceServices)+1)
	for _, svc := range SourceServices {
		out = append(out, svc.DB)
	}
	out = append(out, TargetDB)
	return out
}
