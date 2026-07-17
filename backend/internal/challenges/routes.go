package challenges

import "net/http"

// RegisterRoutes mounts every /challenges/* HTTP endpoint on mux.
// GET /challenges/invites/{token} is public — cmd/api/main.go's allowlist
// covers it via "GET /challenges/invites/*". The literal list route
// GET /challenges/invites stays authenticated (prefix match requires the
// trailing slash + segment). Literal /challenges/invites also beats
// GET /challenges/{id} so "invites" is never captured as an id.
// routeMux is satisfied by *http.ServeMux and by the recording registrar
// used in cmd/api's OpenAPI contract test.
type routeMux interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}

func RegisterRoutes(mux routeMux, h *Handlers) {
	mux.HandleFunc("POST /challenges", h.CreateChallenge)
	mux.HandleFunc("GET /challenges", h.ListChallenges)
	mux.HandleFunc("GET /challenges/{id}", h.GetChallenge)
	mux.HandleFunc("PUT /challenges/{id}/claim", h.ClaimChallenge)
	mux.HandleFunc("DELETE /challenges/{id}", h.CancelChallenge)

	mux.HandleFunc("POST /challenges/invites", h.CreateInvite)
	mux.HandleFunc("GET /challenges/invites", h.ListInvites)
	mux.HandleFunc("DELETE /challenges/invites/{id}", h.RevokeInvite)
	mux.HandleFunc("GET /challenges/invites/{token}", h.ViewInvite)
}
