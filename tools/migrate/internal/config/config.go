package config

import (
	"fmt"
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

// ExpectedCounts match source-row-counts.txt in the archive (refresh_tokens excluded).
var ExpectedCounts = map[string]int{
	"users":                 6,
	"habits":                10,
	"completions":           63,
	"promises":              0,
	"friendships":           2,
	"social_preferences":    1,
	"visibility_settings":   10,
	"witness_links":         1,
	"witness_link_habits":   2,
	"challenges":            1,
	"notifications":         61,
	"device_tokens":         0,
	"notification_settings": 0,
	"feed_entries":          92,
	"refresh_tokens":        169, // deliberately NOT migrated
}

// Config holds CLI-resolved paths and connection settings.
type Config struct {
	ArchiveDir string
	AdminURL   string
	Host       string
	Port       string
	User       string
	Password   string
	ReportPath  string
	DockerImage string
}

func Default() Config {
	return Config{
		AdminURL:    DefaultAdminURL,
		Host:        DefaultHost,
		Port:        DefaultPort,
		User:        DefaultUser,
		Password:    DefaultPassword,
		DockerImage: "postgres:18-alpine",
		ReportPath:  "verification-report.md",
	}
}

func (c Config) SourceURL(db string) string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		c.User, c.Password, c.Host, c.Port, db)
}

func (c Config) TargetURL() string {
	return c.SourceURL(TargetDB)
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
