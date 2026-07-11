package habits

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net/http"
	"time"
)

// UsernameResolver resolves a username to a user id — satisfied
// structurally by *auth.Service (its ResolveUsername method), the in-process
// replacement for the old GET /auth/internal/resolve/{username} HTTP call.
// Defined here instead of importing internal/auth so the habits module
// depends only on this narrow capability; see Service.SetUsernameResolver's
// doc comment for why it's wired after construction.
type UsernameResolver interface {
	ResolveUsername(ctx context.Context, username string) (string, bool, error)
}

// ErrUsernameResolverUnavailable is returned by the public flame endpoints
// when no UsernameResolver has been wired (SetUsernameResolver was never
// called) — a startup wiring bug, not a normal runtime condition, so
// handlers map it to 500 like any other internal error.
var ErrUsernameResolverUnavailable = errors.New("habits: username resolver not configured")

// PublicHabitEntry is one habit in GetPublicFlameProfile's response — the
// per-habit projection in PublicEndpoints.cs.
type PublicHabitEntry struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Icon        *string                `json:"icon"`
	Color       *string                `json:"color"`
	Consistency float64                `json:"consistency"`
	FlameLevel  string                 `json:"flameLevel"`
	Promise     *PublicPromiseResponse `json:"promise"`
}

// PublicFlameProfileResponse is GET /habits/public/{username}'s response
// shape, matching GetPublicFlameProfile in PublicEndpoints.cs.
type PublicFlameProfileResponse struct {
	Username string             `json:"username"`
	Habits   []PublicHabitEntry `json:"habits"`
	Degraded bool               `json:"degraded"`
}

// resolveUsernameForPublic is the shared username->userID step both public
// endpoints start with.
func (s *Service) resolveUsernameForPublic(ctx context.Context, username string) (string, error) {
	if s.usernameResolver == nil {
		return "", ErrUsernameResolverUnavailable
	}
	userID, found, err := s.usernameResolver.ResolveUsername(ctx, username)
	if err != nil {
		return "", fmt.Errorf("habits: resolving username for public flame: %w", err)
	}
	if !found {
		return "", ErrNotFound
	}
	return userID, nil
}

// PublicFlameProfile builds GET /habits/public/{username}'s payload: every
// non-archived habit for the resolved user, its consistency/flame level
// computed with UTC as "today" (the share-surface contract — never a
// viewer timezone, matching the old /habits/user/{userId} export and
// flame.svg), plus any Active, non-expired, IsPublicOnFlame promise for
// that habit.
//
// INTEGRATION POINT (winzy.ai-rdc7.4): the C# source (GetPublicFlameProfile
// in PublicEndpoints.cs) filters habits through the Social service's
// per-habit visibility settings (FetchVisibility) before this projection;
// that service doesn't exist yet in this Go stack, so this interim
// implementation shows EVERY non-archived habit, with no filtering at all.
// This is NOT parity with the old live system: SocialPreference's own
// default (DefaultHabitVisibility = HabitVisibility.Private, see
// Entities/SocialPreference.cs) means the old system showed only
// habits a user had explicitly opted into public visibility — the common
// case in production was showing NOTHING publicly by default, the opposite
// of this interim "show everything" behavior. Public flame pages are
// over-exposed relative to the old system until winzy.ai-rdc7.4 lands the
// social module and this integration point is replaced with a real
// in-process visibility call, restoring parity before cutover. Degraded is
// hardcoded false for the same reason (nothing can currently degrade — there
// is no network call here to fail).
func (s *Service) PublicFlameProfile(ctx context.Context, username string) (PublicFlameProfileResponse, error) {
	userID, err := s.resolveUsernameForPublic(ctx, username)
	if err != nil {
		return PublicFlameProfileResponse{}, err
	}

	habitsList, err := listHabits(ctx, s.pool, userID)
	if err != nil {
		return PublicFlameProfileResponse{}, err
	}

	habitIDs := make([]string, len(habitsList))
	for i, hb := range habitsList {
		habitIDs[i] = hb.ID
	}
	todayUTC := civilDateInLocation(s.now(), time.UTC)
	promises, err := publicPromisesForHabits(ctx, s.pool, userID, habitIDs, todayUTC)
	if err != nil {
		return PublicFlameProfileResponse{}, err
	}

	entries := make([]PublicHabitEntry, len(habitsList))
	for i, hb := range habitsList {
		consistency, err := s.currentConsistency(ctx, hb, time.UTC)
		if err != nil {
			return PublicFlameProfileResponse{}, err
		}
		flame := GetFlameLevel(consistency, nil)

		var promiseResp *PublicPromiseResponse
		if p, ok := promises[hb.ID]; ok {
			r := toPublicPromiseResponse(p, &consistency)
			promiseResp = &r
		}

		entries[i] = PublicHabitEntry{
			ID:          hb.ID,
			Name:        hb.Name,
			Icon:        hb.Icon,
			Color:       hb.Color,
			Consistency: consistency,
			FlameLevel:  flame.String(),
			Promise:     promiseResp,
		}
	}

	return PublicFlameProfileResponse{Username: username, Habits: entries, Degraded: false}, nil
}

// FlameBadge computes the aggregate consistency across every non-archived
// habit for the resolved user (UTC as "today" — the same share-surface
// contract as PublicFlameProfile, including its winzy.ai-rdc7.4 visibility
// INTEGRATION POINT) and returns the rendered SVG badge, matching
// GetFlameBadge in PublicEndpoints.cs.
func (s *Service) FlameBadge(ctx context.Context, username string) (string, error) {
	userID, err := s.resolveUsernameForPublic(ctx, username)
	if err != nil {
		return "", err
	}

	habitsList, err := listHabits(ctx, s.pool, userID)
	if err != nil {
		return "", err
	}

	var aggregate float64
	if len(habitsList) > 0 {
		var total float64
		for _, hb := range habitsList {
			consistency, err := s.currentConsistency(ctx, hb, time.UTC)
			if err != nil {
				return "", err
			}
			total += consistency
		}
		aggregate = total / float64(len(habitsList))
	}

	return renderFlameBadgeSVG(username, GetFlameLevel(aggregate, nil), aggregate), nil
}

// PublicFlameProfileHandler handles GET /habits/public/{username}.
func (h *Handlers) PublicFlameProfile(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")

	resp, err := h.service.PublicFlameProfile(r.Context(), username)
	if err != nil {
		writePublicError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// FlameBadge handles GET /habits/public/{username}/flame.svg.
func (h *Handlers) FlameBadge(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")

	svg, err := h.service.FlameBadge(r.Context(), username)
	if err != nil {
		writePublicError(w, err)
		return
	}

	w.Header().Set("Cache-Control", "public, max-age=300, s-maxage=300")
	w.Header().Set("Content-Type", "image/svg+xml")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(svg))
}

// writePublicError maps a public-surface Service error to its HTTP
// response: ErrNotFound (unknown username) -> a bare 404, matching
// PublicEndpoints.cs's Results.NotFound(); anything else (a DB error, or
// ErrUsernameResolverUnavailable, a startup wiring bug) -> 500. There is no
// 503 branch here — that was the old system's cross-service HTTP failure
// mode (auth as a separate process reached over the network);
// ResolveUsername is now a direct in-process call, so its only outcomes are
// "found," "not found," and "something is genuinely broken," and the last
// one is already a plain internal error.
func writePublicError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		w.WriteHeader(http.StatusNotFound)
	default:
		writeError(w, http.StatusInternalServerError, "Internal server error.")
	}
}

// --- SVG badge rendering (pure function; table-driven-tested in
// promise_public_test.go) ---

// flameBadgeColors maps a FlameLevel to its SVG flame/glow color pair,
// matching GetFlameBadge's switch expression in PublicEndpoints.cs exactly.
func flameBadgeColors(level FlameLevel) (flameColor, glowColor string) {
	switch level {
	case FlameEmber:
		return "#D97706", "#FCD34D"
	case FlameSteady:
		return "#EA580C", "#FDBA74"
	case FlameStrong:
		return "#F97316", "#FCA5A5"
	case FlameBlazing:
		return "#DC2626", "#FECACA"
	default:
		return "#9CA3AF", "#D1D5DB"
	}
}

// renderFlameBadgeSVG is a pure port of the raw-string SVG literal in
// GetFlameBadge (PublicEndpoints.cs) — identical viewBox, paths, and color
// mapping, so the rendered markup matches the C# output byte-for-byte for
// the same inputs (verified in promise_public_test.go's table; the bead
// report leaves a PM review step to diff this against a live C# run
// directly). consistency is rounded the same way the C#'s
// `Math.Round(aggregateConsistency)` does — default MidpointRounding.ToEven
// — via roundNET(consistency, 0) rather than Go's math.Round (which rounds
// half away from zero and would diverge at a .5 midpoint); username is
// escaped with html.EscapeString, a strict superset of what
// SecurityElement.Escape covers (it additionally escapes quotes), which is
// safe inside this text node.
func renderFlameBadgeSVG(username string, level FlameLevel, consistency float64) string {
	flameColor, glowColor := flameBadgeColors(level)
	consistencyText := fmt.Sprintf("%d%%", int(roundNET(consistency, 0)))
	escapedUsername := html.EscapeString(username)

	return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="32" viewBox="0 0 160 32">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1C1917"/>
      <stop offset="100%" stop-color="#292524"/>
    </linearGradient>
  </defs>
  <rect width="160" height="32" rx="6" fill="url(#bg)"/>
  <!-- Flame icon -->
  <circle cx="20" cy="16" r="8" fill="` + glowColor + `" opacity="0.25"/>
  <path d="M20 8 C20 8, 14 14, 14 18 C14 21.3, 16.7 24, 20 24 C23.3 24, 26 21.3, 26 18 C26 14, 20 8, 20 8Z"
        fill="` + flameColor + `" opacity="0.9"/>
  <path d="M20 13 C20 13, 17 16, 17 18.5 C17 20.4, 18.3 22, 20 22 C21.7 22, 23 20.4, 23 18.5 C23 16, 20 13, 20 13Z"
        fill="` + glowColor + `" opacity="0.7"/>
  <!-- Text -->
  <text x="36" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="12" font-weight="600" fill="#FAFAF9">
    ` + escapedUsername + `
  </text>
  <!-- Consistency badge -->
  <rect x="108" y="7" width="44" height="18" rx="9" fill="` + flameColor + `" opacity="0.2"/>
  <text x="130" y="20" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="` + flameColor + `" text-anchor="middle">
    ` + consistencyText + `
  </text>
</svg>`
}
