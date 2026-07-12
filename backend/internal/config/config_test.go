package config

import (
	"log/slog"
	"strings"
	"testing"
)

func env(values map[string]string) func(string) string {
	return func(key string) string {
		return values[key]
	}
}

func TestLoad_HappyPath_ValidEnvIsParsed(t *testing.T) {
	cfg, err := load(env(map[string]string{
		"PORT":                          "9090",
		"DATABASE_URL":                  "postgres://user:pass@db.internal:5432/winzy?sslmode=require",
		"LOG_LEVEL":                     "debug",
		"CORS_ORIGIN":                   "https://winzy.ai",
		"JWT_SECRET":                    "a-real-production-secret-that-is-long-enough",
		"JWT_ACCESS_TOKEN_MINUTES":      "30",
		"JWT_REFRESH_TOKEN_DAYS":        "14",
		"TRUSTED_PROXY":                 "true",
		"RATE_LIMIT_AUTH_PER_MINUTE":    "20",
		"RATE_LIMIT_GENERAL_PER_MINUTE": "500",
	}))
	if err != nil {
		t.Fatalf("load() returned unexpected error: %v", err)
	}
	if cfg.Port != 9090 {
		t.Errorf("Port = %d, want 9090", cfg.Port)
	}
	if cfg.DatabaseURL != "postgres://user:pass@db.internal:5432/winzy?sslmode=require" {
		t.Errorf("DatabaseURL = %q, unexpected", cfg.DatabaseURL)
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Errorf("LogLevel = %v, want Debug", cfg.LogLevel)
	}
	if cfg.CORSOrigin != "https://winzy.ai" {
		t.Errorf("CORSOrigin = %q, want https://winzy.ai", cfg.CORSOrigin)
	}
	if cfg.JWTSecret != "a-real-production-secret-that-is-long-enough" {
		t.Errorf("JWTSecret = %q, unexpected", cfg.JWTSecret)
	}
	if cfg.JWTAccessTokenMinutes != 30 {
		t.Errorf("JWTAccessTokenMinutes = %d, want 30", cfg.JWTAccessTokenMinutes)
	}
	if cfg.JWTRefreshTokenDays != 14 {
		t.Errorf("JWTRefreshTokenDays = %d, want 14", cfg.JWTRefreshTokenDays)
	}
	if !cfg.TrustedProxy {
		t.Error("TrustedProxy = false, want true")
	}
	if cfg.RateLimitAuthPerMinute != 20 {
		t.Errorf("RateLimitAuthPerMinute = %d, want 20", cfg.RateLimitAuthPerMinute)
	}
	if cfg.RateLimitGeneralPerMinute != 500 {
		t.Errorf("RateLimitGeneralPerMinute = %d, want 500", cfg.RateLimitGeneralPerMinute)
	}
}

func TestLoad_EdgeCase_MissingEnvUsesLocalDevDefaults(t *testing.T) {
	cfg, err := load(env(map[string]string{}))
	if err != nil {
		t.Fatalf("load() with no env vars set should use defaults, got error: %v", err)
	}
	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want default 8080", cfg.Port)
	}
	if cfg.DatabaseURL == "" {
		t.Error("DatabaseURL should default to a local-dev connection string, got empty")
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Errorf("LogLevel = %v, want default Info", cfg.LogLevel)
	}
	if cfg.CORSOrigin != "http://localhost:8081" {
		t.Errorf("CORSOrigin = %q, want default http://localhost:8081", cfg.CORSOrigin)
	}
	if cfg.JWTSecret != "" {
		t.Errorf("JWTSecret = %q, want empty when unset (auth.NewTokenService owns validation)", cfg.JWTSecret)
	}
	if cfg.JWTAccessTokenMinutes != 15 {
		t.Errorf("JWTAccessTokenMinutes = %d, want default 15", cfg.JWTAccessTokenMinutes)
	}
	if cfg.JWTRefreshTokenDays != 7 {
		t.Errorf("JWTRefreshTokenDays = %d, want default 7", cfg.JWTRefreshTokenDays)
	}
	if cfg.TrustedProxy {
		t.Error("TrustedProxy = true, want default false")
	}
	if cfg.RateLimitAuthPerMinute != 10 {
		t.Errorf("RateLimitAuthPerMinute = %d, want default 10", cfg.RateLimitAuthPerMinute)
	}
	if cfg.RateLimitGeneralPerMinute != 300 {
		t.Errorf("RateLimitGeneralPerMinute = %d, want default 300", cfg.RateLimitGeneralPerMinute)
	}
}

func TestLoad_EdgeCase_BlankStringTreatedAsUnset(t *testing.T) {
	cfg, err := load(env(map[string]string{"PORT": "   "}))
	if err != nil {
		t.Fatalf("load() with blank PORT should fall back to default, got error: %v", err)
	}
	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want default 8080 for blank env value", cfg.Port)
	}
}

func TestLoad_ErrorCase_GarbagePortFailsFast(t *testing.T) {
	_, err := load(env(map[string]string{"PORT": "not-a-number"}))
	if err == nil {
		t.Fatal("load() with garbage PORT should return an error")
	}
	if !strings.Contains(err.Error(), "PORT") {
		t.Errorf("error %q should mention PORT", err.Error())
	}
}

func TestLoad_ErrorCase_PortOutOfRange(t *testing.T) {
	_, err := load(env(map[string]string{"PORT": "70000"}))
	if err == nil {
		t.Fatal("load() with out-of-range PORT should return an error")
	}
}

func TestLoad_ErrorCase_GarbageDatabaseURLFailsFast(t *testing.T) {
	_, err := load(env(map[string]string{"DATABASE_URL": "not a url at all ::::"}))
	if err == nil {
		t.Fatal("load() with garbage DATABASE_URL should return an error")
	}
	if !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Errorf("error %q should mention DATABASE_URL", err.Error())
	}
}

func TestLoad_ErrorCase_UnknownLogLevelFailsFast(t *testing.T) {
	_, err := load(env(map[string]string{"LOG_LEVEL": "verbose"}))
	if err == nil {
		t.Fatal("load() with unknown LOG_LEVEL should return an error")
	}
	if !strings.Contains(err.Error(), "LOG_LEVEL") {
		t.Errorf("error %q should mention LOG_LEVEL", err.Error())
	}
}

func TestLoad_ErrorCase_CORSOriginWithoutSchemeFailsFast(t *testing.T) {
	_, err := load(env(map[string]string{"CORS_ORIGIN": "localhost:8081"}))
	if err == nil {
		t.Fatal("load() with schemeless CORS_ORIGIN should return an error")
	}
	if !strings.Contains(err.Error(), "CORS_ORIGIN") {
		t.Errorf("error %q should mention CORS_ORIGIN", err.Error())
	}
}

func TestConfig_LogValue_RedactsCredentials(t *testing.T) {
	cfg := Config{
		Port:        8080,
		DatabaseURL: "postgres://user:supersecret@db.internal:5432/winzy",
		LogLevel:    slog.LevelInfo,
		CORSOrigin:  "http://localhost:8081",
		JWTSecret:   "a-real-production-secret-that-is-long-enough",
	}
	rendered := cfg.LogValue().String()
	if strings.Contains(rendered, "supersecret") {
		t.Errorf("LogValue() leaked the password: %s", rendered)
	}
	if strings.Contains(rendered, "user:supersecret") {
		t.Errorf("LogValue() leaked the username:password pair: %s", rendered)
	}
	if strings.Contains(rendered, "a-real-production-secret-that-is-long-enough") {
		t.Errorf("LogValue() leaked JWTSecret: %s", rendered)
	}
}

func TestLoad_ErrorCase_GarbageJWTAccessTokenMinutesFailsFast(t *testing.T) {
	_, err := load(env(map[string]string{"JWT_ACCESS_TOKEN_MINUTES": "not-a-number"}))
	if err == nil {
		t.Fatal("load() with garbage JWT_ACCESS_TOKEN_MINUTES should return an error")
	}
	if !strings.Contains(err.Error(), "JWT_ACCESS_TOKEN_MINUTES") {
		t.Errorf("error %q should mention JWT_ACCESS_TOKEN_MINUTES", err.Error())
	}
}

func TestLoad_ErrorCase_ZeroJWTRefreshTokenDaysFailsFast(t *testing.T) {
	_, err := load(env(map[string]string{"JWT_REFRESH_TOKEN_DAYS": "0"}))
	if err == nil {
		t.Fatal("load() with JWT_REFRESH_TOKEN_DAYS=0 should return an error")
	}
}

func TestLoad_ErrorCase_NegativeRateLimitAuthPerMinuteFailsFast(t *testing.T) {
	_, err := load(env(map[string]string{"RATE_LIMIT_AUTH_PER_MINUTE": "-1"}))
	if err == nil {
		t.Fatal("load() with a negative RATE_LIMIT_AUTH_PER_MINUTE should return an error")
	}
}

func TestLoad_ErrorCase_GarbageRateLimitGeneralPerMinuteFailsFast(t *testing.T) {
	_, err := load(env(map[string]string{"RATE_LIMIT_GENERAL_PER_MINUTE": "lots"}))
	if err == nil {
		t.Fatal("load() with garbage RATE_LIMIT_GENERAL_PER_MINUTE should return an error")
	}
	if !strings.Contains(err.Error(), "RATE_LIMIT_GENERAL_PER_MINUTE") {
		t.Errorf("error %q should mention RATE_LIMIT_GENERAL_PER_MINUTE", err.Error())
	}
}

func TestLoad_ErrorCase_InvalidTrustedProxyFailsFast(t *testing.T) {
	_, err := load(env(map[string]string{"TRUSTED_PROXY": "sometimes"}))
	if err == nil || !strings.Contains(err.Error(), "TRUSTED_PROXY") {
		t.Errorf("load() error = %v, want TRUSTED_PROXY parse error", err)
	}
}

func TestLoad_EdgeCase_MaximumTokenDurationsAccepted(t *testing.T) {
	cfg, err := load(env(map[string]string{
		"JWT_ACCESS_TOKEN_MINUTES": "1440",
		"JWT_REFRESH_TOKEN_DAYS":   "3650",
	}))
	if err != nil {
		t.Fatalf("load() returned unexpected error: %v", err)
	}
	if cfg.JWTAccessTokenMinutes != 1440 || cfg.JWTRefreshTokenDays != 3650 {
		t.Errorf("durations = %d minutes/%d days, want 1440/3650", cfg.JWTAccessTokenMinutes, cfg.JWTRefreshTokenDays)
	}
}

func TestLoad_ErrorCase_ExcessiveTokenDurationsFailFast(t *testing.T) {
	for envVar, value := range map[string]string{
		"JWT_ACCESS_TOKEN_MINUTES": "1441",
		"JWT_REFRESH_TOKEN_DAYS":   "3651",
	} {
		_, err := load(env(map[string]string{envVar: value}))
		if err == nil || !strings.Contains(err.Error(), envVar) {
			t.Errorf("%s=%s error = %v, want named upper-bound error", envVar, value, err)
		}
	}
}
