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
		"PORT":         "9090",
		"DATABASE_URL": "postgres://user:pass@db.internal:5432/winzy?sslmode=require",
		"LOG_LEVEL":    "debug",
		"CORS_ORIGIN":  "https://winzy.ai",
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
	}
	rendered := cfg.LogValue().String()
	if strings.Contains(rendered, "supersecret") {
		t.Errorf("LogValue() leaked the password: %s", rendered)
	}
	if strings.Contains(rendered, "user:supersecret") {
		t.Errorf("LogValue() leaked the username:password pair: %s", rendered)
	}
}
