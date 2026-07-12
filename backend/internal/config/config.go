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
	// JWTSecret signs and verifies access tokens. It has no local-dev
	// default — auth.NewTokenService is the single source of truth for
	// validating it (non-empty, >=32 chars, not a known placeholder), so
	// Load passes the raw value through unchecked rather than duplicating
	// that validation here.
	JWTSecret string
	// JWTAccessTokenMinutes is the access token lifetime in minutes.
	JWTAccessTokenMinutes int
	// JWTRefreshTokenDays is the refresh token lifetime in days.
	JWTRefreshTokenDays int
	// TrustedProxy enables Railway's X-Real-IP client address contract.
	TrustedProxy bool
	// RateLimitAuthPerMinute caps requests per client IP per minute to
	// /auth/* endpoints.
	RateLimitAuthPerMinute int
	// RateLimitGeneralPerMinute caps requests per client IP per minute to
	// every other endpoint.
	RateLimitGeneralPerMinute int
	// VAPIDSubject is the Web Push VAPID JWT subject (mailto: or https: URL).
	// Cutover mapping (rdc7.10): WebPush__Subject → VAPID_SUBJECT.
	VAPIDSubject string
	// VAPIDPublicKey is the base64url-encoded VAPID public key. Must be the
	// SAME key browsers already hold subscriptions against (HARD COMPATIBILITY
	// CONSTRAINT on winzy.ai-rdc7.6). Cutover: WebPush__PublicKey → VAPID_PUBLIC_KEY.
	VAPIDPublicKey string
	// VAPIDPrivateKey is the base64url-encoded VAPID private key.
	// Cutover: WebPush__PrivateKey → VAPID_PRIVATE_KEY.
	VAPIDPrivateKey string
	// WebDist is the filesystem path to the Expo web export (plus assets).
	// Empty/unset keeps the process API-only — unit tests and local API
	// dev stay unchanged. When set, cmd/api serves the SPA same-origin
	// beside the API (winzy.ai-rdc7.8.2).
	WebDist string
}

const (
	defaultPort                      = "8080"
	defaultDatabaseURL               = "postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable"
	defaultLogLevel                  = "info"
	defaultCORSOrigin                = "http://localhost:8081"
	defaultJWTAccessTokenMinutes     = "15"
	defaultJWTRefreshTokenDays       = "7"
	defaultTrustedProxy              = "false"
	defaultRateLimitAuthPerMinute    = "10"
	defaultRateLimitGeneralPerMinute = "300"
	maxJWTAccessTokenMinutes         = 24 * 60
	maxJWTRefreshTokenDays           = 3650
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

	// JWTSecret is passed through as-is (even if empty): auth.NewTokenService
	// is the single source of truth for validating it, so Load only reads it.
	cfg.JWTSecret = getenv("JWT_SECRET")

	accessMinutes, err := parseBoundedPositiveInt("JWT_ACCESS_TOKEN_MINUTES", valueOrDefault(getenv("JWT_ACCESS_TOKEN_MINUTES"), defaultJWTAccessTokenMinutes), maxJWTAccessTokenMinutes)
	if err != nil {
		return Config{}, err
	}
	cfg.JWTAccessTokenMinutes = accessMinutes

	refreshDays, err := parseBoundedPositiveInt("JWT_REFRESH_TOKEN_DAYS", valueOrDefault(getenv("JWT_REFRESH_TOKEN_DAYS"), defaultJWTRefreshTokenDays), maxJWTRefreshTokenDays)
	if err != nil {
		return Config{}, err
	}
	cfg.JWTRefreshTokenDays = refreshDays

	trustedProxy, err := strconv.ParseBool(valueOrDefault(getenv("TRUSTED_PROXY"), defaultTrustedProxy))
	if err != nil {
		return Config{}, fmt.Errorf("config: TRUSTED_PROXY %q is not a valid boolean: %w", getenv("TRUSTED_PROXY"), err)
	}
	cfg.TrustedProxy = trustedProxy

	authLimit, err := parsePositiveInt("RATE_LIMIT_AUTH_PER_MINUTE", valueOrDefault(getenv("RATE_LIMIT_AUTH_PER_MINUTE"), defaultRateLimitAuthPerMinute))
	if err != nil {
		return Config{}, err
	}
	cfg.RateLimitAuthPerMinute = authLimit

	generalLimit, err := parsePositiveInt("RATE_LIMIT_GENERAL_PER_MINUTE", valueOrDefault(getenv("RATE_LIMIT_GENERAL_PER_MINUTE"), defaultRateLimitGeneralPerMinute))
	if err != nil {
		return Config{}, err
	}
	cfg.RateLimitGeneralPerMinute = generalLimit

	// VAPID keys are optional: all three missing → push disabled (C#
	// PushDeliveryService parity — skip sends, KEEP tokens). Partial config
	// is still accepted here; notifications.NewService decides whether push
	// is enabled once it sees the resolved triple.
	cfg.VAPIDSubject = strings.TrimSpace(getenv("VAPID_SUBJECT"))
	cfg.VAPIDPublicKey = strings.TrimSpace(getenv("VAPID_PUBLIC_KEY"))
	cfg.VAPIDPrivateKey = strings.TrimSpace(getenv("VAPID_PRIVATE_KEY"))

	cfg.WebDist = strings.TrimSpace(getenv("WEB_DIST"))

	return cfg, nil
}

// parsePositiveInt parses value as a positive integer, returning an error
// naming envVar so a bad setting is easy to trace back to its source.
func parsePositiveInt(envVar, value string) (int, error) {
	n, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("config: %s %q is not a valid integer: %w", envVar, value, err)
	}
	if n < 1 {
		return 0, fmt.Errorf("config: %s %d must be at least 1", envVar, n)
	}
	return n, nil
}

func parseBoundedPositiveInt(envVar, value string, max int) (int, error) {
	n, err := parsePositiveInt(envVar, value)
	if err != nil {
		return 0, err
	}
	if n > max {
		return 0, fmt.Errorf("config: %s %d must not exceed %d", envVar, n, max)
	}
	return n, nil
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
	jwtSecretStatus := "unset"
	if c.JWTSecret != "" {
		jwtSecretStatus = "REDACTED"
	}
	vapidStatus := "unset"
	if c.VAPIDPublicKey != "" || c.VAPIDPrivateKey != "" {
		vapidStatus = "REDACTED"
	}
	return slog.GroupValue(
		slog.Int("port", c.Port),
		slog.String("database_url", redactUserinfo(c.DatabaseURL)),
		slog.String("log_level", c.LogLevel.String()),
		slog.String("cors_origin", c.CORSOrigin),
		slog.String("jwt_secret", jwtSecretStatus),
		slog.Int("jwt_access_token_minutes", c.JWTAccessTokenMinutes),
		slog.Int("jwt_refresh_token_days", c.JWTRefreshTokenDays),
		slog.Bool("trusted_proxy", c.TrustedProxy),
		slog.Int("rate_limit_auth_per_minute", c.RateLimitAuthPerMinute),
		slog.Int("rate_limit_general_per_minute", c.RateLimitGeneralPerMinute),
		slog.String("vapid_keys", vapidStatus),
		slog.Bool("vapid_subject_set", c.VAPIDSubject != ""),
		slog.String("web_dist", c.WebDist),
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
