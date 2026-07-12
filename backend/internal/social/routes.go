package social

import "net/http"

// RegisterRoutes mounts every /social/* HTTP endpoint on mux. Every route
// requires auth EXCEPT GET /social/witness/{token} — cmd/api/main.go's
// public-route allowlist covers it via a "GET /social/witness/*" prefix
// entry (see auth.Middleware's isPublicRoute doc comment; the same "*"
// convention habits' public flame surfaces use). No /social/internal/*
// routes exist — those became direct in-process calls (crossmodule.go) and
// the export.Section registered in NewService, matching how habits never
// exposed /habits/user/{userId} or /habits/internal/* as routes either.
//
// None of the routes below overlap in a way net/http's ServeMux (Go 1.22+)
// can't resolve unambiguously: GET /social/friends/requests/count and GET
// /social/friends/{friendId}/profile are both 4 segments, but their final
// literal segment differs ("count" vs "profile"), so no concrete request
// path can match both patterns — unlike habits' habitOrPublicGET case
// (RegisterRoutes' doc comment there), there is no genuine ambiguity here
// requiring a merged manual-dispatch handler.
func RegisterRoutes(mux *http.ServeMux, h *Handlers) {
	mux.HandleFunc("POST /social/friends/request", h.SendFriendRequest)
	mux.HandleFunc("PUT /social/friends/request/{id}/accept", h.AcceptFriendRequest)
	mux.HandleFunc("PUT /social/friends/request/{id}/decline", h.DeclineFriendRequest)
	mux.HandleFunc("DELETE /social/friends/{friendId}", h.RemoveFriend)
	mux.HandleFunc("GET /social/friends", h.ListFriends)
	mux.HandleFunc("GET /social/friends/requests/count", h.GetPendingRequestCount)
	mux.HandleFunc("GET /social/friends/requests", h.ListFriendRequests)
	mux.HandleFunc("GET /social/friends/{friendId}/profile", h.GetFriendProfile)

	mux.HandleFunc("PUT /social/visibility/{habitId}", h.SetHabitVisibility)
	mux.HandleFunc("GET /social/preferences", h.GetPreferences)
	mux.HandleFunc("PUT /social/preferences", h.UpdatePreferences)
	mux.HandleFunc("GET /social/visibility", h.GetBatchVisibility)

	mux.HandleFunc("POST /social/witness-links", h.CreateWitnessLink)
	mux.HandleFunc("GET /social/witness-links", h.ListWitnessLinks)
	mux.HandleFunc("PUT /social/witness-links/{id}", h.UpdateWitnessLink)
	mux.HandleFunc("DELETE /social/witness-links/{id}", h.RevokeWitnessLink)
	mux.HandleFunc("POST /social/witness-links/{id}/rotate", h.RotateToken)
	mux.HandleFunc("GET /social/witness/{token}", h.ViewWitnessLink)
}
