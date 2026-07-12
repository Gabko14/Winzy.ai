package httpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// shutdownTimeout bounds how long Serve waits for in-flight requests to
// finish once the context is cancelled, before forcing the listener closed.
const shutdownTimeout = 10 * time.Second

// New wraps handler in the fixed middleware stack (recovery, request
// logging, CORS) and returns an *http.Server bound to port.
// sensitiveLogPathPrefixes is passed straight through to BOTH Recovery and
// RequestLogging — see their doc comments; cmd/api/main.go supplies
// "/social/witness/" here.
func New(port int, corsOrigin string, handler http.Handler, logger *slog.Logger, sensitiveLogPathPrefixes ...string) *http.Server {
	wrapped := Chain(handler,
		Recovery(logger, sensitiveLogPathPrefixes...),
		RequestLogging(logger, sensitiveLogPathPrefixes...),
		CORS(corsOrigin),
	)
	return &http.Server{
		Addr:              fmt.Sprintf(":%d", port),
		Handler:           wrapped,
		ReadHeaderTimeout: 5 * time.Second,
	}
}

// Serve starts srv and blocks until ctx is cancelled (typically by a
// SIGINT/SIGTERM signal context), then shuts it down gracefully. It returns
// nil on a clean shutdown, or the error that caused the server to stop.
func Serve(ctx context.Context, srv *http.Server, logger *slog.Logger) error {
	serveErr := make(chan error, 1)
	go func() {
		logger.Info("http server starting", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
		logger.Info("shutdown signal received, draining in-flight requests")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("httpserver: graceful shutdown failed: %w", err)
		}
		logger.Info("shutdown complete")
		return nil
	}
}
