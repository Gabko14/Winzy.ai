package main

import (
	"net/http"

	"github.com/Gabko14/winzy/backend/internal/activity"
	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/challenges"
	"github.com/Gabko14/winzy/backend/internal/habits"
	"github.com/Gabko14/winzy/backend/internal/notifications"
	"github.com/Gabko14/winzy/backend/internal/social"
)

// routeMux is satisfied by *http.ServeMux and by the recording registrar in
// the OpenAPI contract test.
type routeMux interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}

// apiHandlers holds the per-module HTTP handlers registered on the API mux.
// Construction may pass empty handler values in contract tests — registration
// only stores function values and never invokes them.
type apiHandlers struct {
	health        http.HandlerFunc
	auth          *auth.Handlers
	habits        *habits.Handlers
	social        *social.Handlers
	challenges    *challenges.Handlers
	notifications *notifications.Handlers
	activity      *activity.Handlers
}

// registerAPIRoutes mounts every public HTTP route on mux. Pure registration
// — no middleware, no server start.
func registerAPIRoutes(mux routeMux, h apiHandlers) {
	mux.HandleFunc("GET /health", h.health)
	auth.RegisterRoutes(mux, h.auth)
	habits.RegisterRoutes(mux, h.habits)
	social.RegisterRoutes(mux, h.social)
	challenges.RegisterRoutes(mux, h.challenges)
	notifications.RegisterRoutes(mux, h.notifications)
	activity.RegisterRoutes(mux, h.activity)
}
