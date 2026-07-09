// Command api is the entrypoint for the Winzy Go backend. This scaffold
// wires config, the DB pool, migrations, and GET /health; feature modules
// (auth, habits, social, ...) register their own routes in later beads.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/config"
	"github.com/Gabko14/winzy/backend/internal/db"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/health"
	"github.com/Gabko14/winzy/backend/internal/httpserver"
	"github.com/Gabko14/winzy/backend/internal/ratelimit"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal startup error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(logger)
	logger.Info("starting winzy api", "config", cfg)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := db.Migrate(cfg.DatabaseURL); err != nil {
		return fmt.Errorf("running migrations: %w", err)
	}
	logger.Info("migrations applied")

	pool, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connecting to database: %w", err)
	}
	defer pool.Close()

	tokens, err := auth.NewTokenService(cfg.JWTSecret, cfg.JWTAccessTokenMinutes, cfg.JWTRefreshTokenDays)
	if err != nil {
		return fmt.Errorf("configuring auth tokens: %w", err)
	}

	// The in-process hook registry (replaces NATS) and the export-section
	// registry (replaces the old GET /auth/export HTTP fan-out) are shared
	// across every module; later module beads register their own event
	// handlers and export sections into these same instances.
	registry := events.New(logger)
	exportRegistry := export.New(logger)

	authService := auth.NewService(pool, tokens, registry, exportRegistry, logger)
	authHandlers := auth.NewHandlers(authService)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health.Handler(pool))
	auth.RegisterRoutes(mux, authHandlers)

	// Public-route allowlist: auth's own slice plus GET /health (every
	// service's health check must be reachable without a token — Railway,
	// docker healthcheck, and uptime monitoring all hit it directly).
	// Later module beads (habits, social, notifications) add their own
	// public routes here too.
	publicRoutes := auth.DefaultPublicRoutes()
	publicRoutes["GET /health"] = true
	protected := auth.Middleware(tokens, publicRoutes)(mux)

	generalLimiter := ratelimit.New(cfg.RateLimitGeneralPerMinute, time.Minute)
	authLimiter := ratelimit.New(cfg.RateLimitAuthPerMinute, time.Minute)
	rateLimited := ratelimit.PrefixMiddleware(generalLimiter, authLimiter, "/auth/")(protected)

	srv := httpserver.New(cfg.Port, cfg.CORSOrigin, rateLimited, logger)
	return httpserver.Serve(ctx, srv, logger)
}
