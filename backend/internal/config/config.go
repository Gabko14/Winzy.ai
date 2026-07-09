// Package config loads process configuration from environment variables,
// applying local-dev defaults and failing fast on invalid values.
package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Config holds every environment-derived setting the API server needs.
type Config struct {
	// Port is the TCP port the HTTP server listens on.
	Port int
	// DatabaseURL is a postgres:// connection string for the single Winzy database.
	DatabaseURL string
	// LogLevel controls the minimum slog level emitted at startup.
	LogLevel slog.Level
	// CORSOrigin is the single allowed Origin for browser requests (the Expo web app).
	CORSOrigin string
}

const (
	defaultPort        = "8080"
	defaultDatabaseURL = "postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable"
	defaultLogLevel    = "info"
	defaultCORSOrigin  = "http://localhost:8081"
)

// Load reads PORT, DATABASE_URL, LOG_LEVEL and CORS_ORIGIN from the
// environment, substituting local-dev defaults for anything unset, and
// returns an error describing exactly what is wrong the moment a value fails
// to parse. Callers should treat a non-nil error as fatal.
func Load() (Config, error) {
	return load(os.Getenv)
}

// load is the testable core of Load; getenv is injected so tests can supply
// arbitrary environments without mutating process-global state.
func load(getenv func(string) string) (Config, error) {
	cfg := Config{}

	portStr := valueOrDefault(getenv("PORT"), defaultPort)
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return Config{}, fmt.Errorf("config: PORT %q is not a valid integer: %w", portStr, err)
	}
	if port < 1 || port > 65535 {
		return Config{}, fmt.Errorf("config: PORT %d is out of range 1-65535", port)
	}
	cfg.Port = port

	dbURL := valueOrDefault(getenv("DATABASE_URL"), defaultDatabaseURL)
	if _, err := pgxpool.ParseConfig(dbURL); err != nil {
		return Config{}, fmt.Errorf("config: DATABASE_URL is not a valid postgres connection string: %w", err)
	}
	cfg.DatabaseURL = dbURL

	levelStr := valueOrDefault(getenv("LOG_LEVEL"), defaultLogLevel)
	level, err := parseLogLevel(levelStr)
	if err != nil {
		return Config{}, err
	}
	cfg.LogLevel = level

	corsOrigin := valueOrDefault(getenv("CORS_ORIGIN"), defaultCORSOrigin)
	parsed, err := url.Parse(corsOrigin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return Config{}, fmt.Errorf("config: CORS_ORIGIN %q must be an absolute URL (scheme + host)", corsOrigin)
	}
	cfg.CORSOrigin = corsOrigin

	return cfg, nil
}

func valueOrDefault(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func parseLogLevel(s string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("config: LOG_LEVEL %q must be one of debug, info, warn, error", s)
	}
}

// LogValue implements slog.LogValuer so logging a Config never leaks
// DATABASE_URL's embedded credentials.
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.Int("port", c.Port),
		slog.String("database_url", redactUserinfo(c.DatabaseURL)),
		slog.String("log_level", c.LogLevel.String()),
		slog.String("cors_origin", c.CORSOrigin),
	)
}

// redactUserinfo replaces the user:password portion of a connection string
// with "REDACTED" while leaving the host/db/query visible for debugging.
func redactUserinfo(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "REDACTED"
	}
	if parsed.User != nil {
		parsed.User = url.UserPassword("REDACTED", "REDACTED")
	}
	return parsed.String()
}
