// Package health implements the GET /health endpoint every service in
// CLAUDE.md's convention must expose: process status plus real DB
// connectivity.
package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// Pinger is satisfied by *pgxpool.Pool. It is a narrow interface so tests
// can substitute a fake without touching a real database.
type Pinger interface {
	Ping(ctx context.Context) error
}

const pingTimeout = 2 * time.Second

type response struct {
	Status string `json:"status"`
	DB     string `json:"db"`
}

// Handler returns an http.HandlerFunc for GET /health that pings db and
// reports {"status":"healthy","db":"up"} or, if the ping fails,
// {"status":"unhealthy","db":"down"} with a 503.
func Handler(db Pinger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), pingTimeout)
		defer cancel()

		resp := response{Status: "healthy", DB: "up"}
		status := http.StatusOK
		if err := db.Ping(ctx); err != nil {
			resp = response{Status: "unhealthy", DB: "down"}
			status = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(resp)
	}
}
