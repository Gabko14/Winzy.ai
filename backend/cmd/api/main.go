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
	"github.com/Gabko14/winzy/backend/internal/habits"
	"github.com/Gabko14/winzy/backend/internal/health"
	"github.com/Gabko14/winzy/backend/internal/httpserver"
	"github.com/Gabko14/winzy/backend/internal/ratelimit"
	"github.com/Gabko14/winzy/backend/internal/social"
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

	habitsService := habits.NewService(pool, registry, exportRegistry, logger)
	// authService satisfies habits.UsernameResolver structurally (its
	// ResolveUsername method) — the public flame endpoints' in-process
	// replacement for the old GET /auth/internal/resolve/{username} call.
	habitsService.SetUsernameResolver(authService)
	habitsHandlers := habits.NewHandlers(habitsService)

	// social may import auth and habits directly (friend-list enrichment via
	// auth.BatchProfiles, ownership/flame reads via habits.GetHabit/
	// HabitsForUser — see internal/social's service.go doc comment); the
	// reverse wiring below (habitsService.SetVisibilityFilter) is what keeps
	// habits from importing social back, closing the loop with the narrow
	// habits.PublicVisibilityFilter interface instead.
	socialService := social.NewService(pool, registry, exportRegistry, authService, habitsService, logger)
	// socialService satisfies habits.PublicVisibilityFilter structurally (its
	// VisibleHabitIDs method) — the public flame surfaces' in-process
	// replacement for the old GET
	// /social/internal/visible-habits/{userId}?viewer=public call.
	habitsService.SetVisibilityFilter(socialService)
	socialHandlers := social.NewHandlers(socialService)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health.Handler(pool))
	auth.RegisterRoutes(mux, authHandlers)
	habits.RegisterRoutes(mux, habitsHandlers)
	social.RegisterRoutes(mux, socialHandlers)

	// Public-route allowlist: auth's own slice, GET /health (every service's
	// health check must be reachable without a token — Railway, docker
	// healthcheck, and uptime monitoring all hit it directly), habits'
	// public flame surfaces, and social's Witness Link viewer. "GET
	// /habits/public/*" and "GET /social/witness/*" are prefix entries (see
	// auth.Middleware's isPublicRoute doc comment) covering routes whose
	// final path segment (a username or a witness token) isn't enumerable as
	// an exact route. Later module beads (notifications) add their own
	// public routes here too.
	publicRoutes := auth.DefaultPublicRoutes()
	publicRoutes["GET /health"] = true
	publicRoutes["GET /habits/public/*"] = true
	publicRoutes["GET /social/witness/*"] = true
	protected := auth.Middleware(tokens, publicRoutes)(mux)

	// BodyLimit sits between the rate limiter and the router (not in
	// httpserver.New's fixed chain — see its doc comment): rate limiting
	// must see the request before any body is read, so a flood of
	// oversized bodies is rejected by the limiter, not by allocating up to
	// 1 MiB per request first.
	bodyLimited := httpserver.BodyLimit()(protected)

	generalLimiter := ratelimit.New(cfg.RateLimitGeneralPerMinute, time.Minute)
	authLimiter := ratelimit.New(cfg.RateLimitAuthPerMinute, time.Minute)
	rateLimited := ratelimit.PrefixMiddleware(generalLimiter, authLimiter, "/auth/", cfg.TrustedProxy)(bodyLimited)

	// "/social/witness/" is redacted from request logs — its trailing path
	// segment is the witness token itself, a bearer credential that must
	// never reach stdout/Railway logs (see httpserver.RequestLogging's doc
	// comment).
	srv := httpserver.New(cfg.Port, cfg.CORSOrigin, rateLimited, logger, "/social/witness/")
	return httpserver.Serve(ctx, srv, logger)
}
