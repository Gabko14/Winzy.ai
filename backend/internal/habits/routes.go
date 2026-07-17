package habits

import "net/http"

// RegisterRoutes mounts every /habits/* HTTP endpoint on mux. Every route
// requires auth EXCEPT the two public flame surfaces (GET
// /habits/public/{username} and its /flame.svg sibling) — cmd/api/main.go's
// public-route allowlist covers those via a "GET /habits/public/*" prefix
// entry (see auth.Middleware's doc comment). None of the rest are
// internal-only endpoints exposed through the Gateway pattern the old
// system used (the old /habits/user/{userId} and /habits/internal/...
// endpoints become direct in-process calls once other modules need them,
// per the epic).
//
// The literal "GET /habits/completions" route is registered so it takes
// precedence over the wildcard "GET /habits/{id}" for that exact path —
// net/http's ServeMux (Go 1.22+) resolves this correctly regardless of
// registration order (a longer literal prefix always wins over an
// overlapping wildcard at the SAME path position), but it is listed first
// here for readability.
//
// GET /habits/{id}/stats, GET /habits/{id}/promise, and GET
// /habits/public/{username} are NOT three separate registrations, despite
// all being distinct fixed contracts: ServeMux can't order them, because
// "public" (a literal at the second path segment) and "{id}" (a wildcard at
// that same second segment) each win at a different position — "public"
// beats {id} at segment 2, but "stats"/"promise" beats {username} at
// segment 3 — so neither pattern is a strict subset of the other and
// ServeMux panics at startup with "ambiguous pattern" (this is the same
// class of gap auth.Middleware's isPublicRoute "*"-prefix convention works
// around for the JWT allowlist, but that trick doesn't apply here — this is
// ServeMux's own routing table, not a map lookup). habitOrPublicGET below
// dispatches all three manually on the two path segments instead. GET
// /habits/public/{username}/flame.svg has no such conflict (there is no
// other 4-segment GET route) and stays a plain ServeMux pattern.
// routeMux is satisfied by *http.ServeMux and by the recording registrar
// used in cmd/api's OpenAPI contract test.
type routeMux interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}

func RegisterRoutes(mux routeMux, h *Handlers) {
	mux.HandleFunc("POST /habits", h.CreateHabit)
	mux.HandleFunc("GET /habits", h.ListHabits)
	mux.HandleFunc("GET /habits/completions", h.CompletionsInRange)
	mux.HandleFunc("GET /habits/{a}/{b}", h.habitOrPublicGET)
	mux.HandleFunc("GET /habits/public/{username}/flame.svg", h.FlameBadge)
	mux.HandleFunc("GET /habits/{id}", h.GetHabit)
	mux.HandleFunc("PUT /habits/{id}", h.UpdateHabit)
	mux.HandleFunc("DELETE /habits/{id}", h.ArchiveHabit)
	mux.HandleFunc("POST /habits/{id}/complete", h.CompleteHabit)
	mux.HandleFunc("DELETE /habits/{id}/completions/{date}", h.DeleteCompletion)
	mux.HandleFunc("PUT /habits/{id}/completions/{date}", h.UpdateCompletion)
	mux.HandleFunc("POST /habits/{id}/promise", h.CreatePromise)
	mux.HandleFunc("DELETE /habits/{id}/promise", h.CancelPromise)
	mux.HandleFunc("PATCH /habits/{id}/promise/visibility", h.ToggleVisibility)
}

// habitOrPublicGET is the single registration covering GET
// /habits/{id}/stats, GET /habits/{id}/promise, and GET
// /habits/public/{username} — see RegisterRoutes' doc comment for why these
// three can't be separate ServeMux patterns. {a} is "public" (route to the
// public flame profile, {b} is the username) or a habit id (route on {b}:
// "stats" or "promise"); anything else 404s. A real habit id can never
// literally equal "public" (ids are canonical UUIDs, enforced by
// isValidUUID before any DB lookup), so there is no real ambiguity in
// practice — only in what ServeMux's pattern matcher can prove statically.
func (h *Handlers) habitOrPublicGET(w http.ResponseWriter, r *http.Request) {
	a, b := r.PathValue("a"), r.PathValue("b")

	if a == "public" {
		r.SetPathValue("username", b)
		h.PublicFlameProfile(w, r)
		return
	}

	r.SetPathValue("id", a)
	switch b {
	case "stats":
		h.Stats(w, r)
	case "promise":
		h.GetPromise(w, r)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}
