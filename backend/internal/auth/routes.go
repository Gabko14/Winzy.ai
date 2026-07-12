package auth

import "net/http"

// RegisterRoutes mounts every /auth/* HTTP endpoint on mux. The old
// /auth/internal/* endpoints (resolve-username, batch-profiles, per-user
// export) are deliberately NOT mounted here — see Service.ResolveUsername,
// Service.BatchProfiles, and the export.Registry "auth" section, which
// replace them with direct in-process calls.
// routeMux is satisfied by *http.ServeMux and by the recording registrar
// used in cmd/api's OpenAPI contract test.
type routeMux interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}

func RegisterRoutes(mux routeMux, h *Handlers) {
	mux.HandleFunc("POST /auth/register", h.Register)
	mux.HandleFunc("POST /auth/login", h.Login)
	mux.HandleFunc("POST /auth/refresh", h.Refresh)
	mux.HandleFunc("POST /auth/logout", h.Logout)
	mux.HandleFunc("GET /auth/profile", h.GetProfile)
	mux.HandleFunc("PUT /auth/profile", h.UpdateProfile)
	mux.HandleFunc("PUT /auth/password", h.ChangePassword)
	mux.HandleFunc("DELETE /auth/account", h.DeleteAccount)
	mux.HandleFunc("GET /auth/export", h.Export)
	mux.HandleFunc("GET /auth/users/search", h.SearchUsers)
}
