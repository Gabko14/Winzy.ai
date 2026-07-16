package habits

import (
	"context"
	"errors"
	"fmt"
	"html"
	"math"
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

// PublicVisibilityFilter narrows a habit-id candidate set down to the ones
// visible to the anonymous/public viewer — satisfied structurally by
// *social.Service (its VisibleHabitIDs method), the in-process replacement
// for the old GET /social/internal/visible-habits/{userId}?viewer=public
// HTTP call PublicEndpoints.cs's GetPublicFlameProfile/GetFlameBadge made.
// Defined here instead of importing internal/social so habits depends only
// on this narrow capability (habits must not import social — the dependency
// runs the other way, social imports habits directly for ownership/flame
// reads, see internal/social's crossmodule.go) — set via
// SetVisibilityFilter, exactly like SetUsernameResolver above. The interface
// takes the candidate habitIDs (rather than looking them up itself) because
// only habits knows a user's full non-archived habit set; social has no
// habit list of its own to enumerate.
type PublicVisibilityFilter interface {
	VisibleHabitIDs(ctx context.Context, ownerID string, habitIDs []string) (map[string]bool, error)
}

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
// non-archived habit for the resolved user that passes the visibility
// filter, its consistency/flame level computed with UTC as "today" (the
// share-surface contract — never a viewer timezone, matching the old
// /habits/user/{userId} export and flame.svg), plus any Active, non-expired,
// IsPublicOnFlame promise for that habit.
//
// The visibility filter (winzy.ai-rdc7.4's INTEGRATION POINT, now wired) is
// s.visibilityFilter, set via SetVisibilityFilter — see that method's doc
// comment for why this is a narrow interface rather than an import of
// internal/social. A nil filter (SetVisibilityFilter never called — a
// startup wiring bug) falls back to showing every non-archived habit, the
// pre-winzy.ai-rdc7.4 interim behavior; production wiring in
// cmd/api/main.go always sets one. Degraded stays hardcoded false: the
// visibility filter and the promise/consistency reads below are all
// in-process calls, so there is nothing here that can genuinely degrade the
// way a cross-service HTTP call could in the old system — a filter error is
// a real failure (mapped to 500 by writePublicError), not degradation.
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

	if s.visibilityFilter != nil {
		visible, err := s.visibilityFilter.VisibleHabitIDs(ctx, userID, habitIDs)
		if err != nil {
			return PublicFlameProfileResponse{}, fmt.Errorf("habits: filtering public habits by visibility: %w", err)
		}
		filtered := make([]Habit, 0, len(habitsList))
		filteredIDs := make([]string, 0, len(habitIDs))
		for _, hb := range habitsList {
			if visible[hb.ID] {
				filtered = append(filtered, hb)
				filteredIDs = append(filteredIDs, hb.ID)
			}
		}
		habitsList, habitIDs = filtered, filteredIDs
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
// habit for the resolved user that passes the visibility filter (UTC as
// "today" — the same share-surface contract as PublicFlameProfile,
// including its visibility filtering; see that method's doc comment) and
// returns the rendered SVG badge, matching GetFlameBadge in
// PublicEndpoints.cs.
func (s *Service) FlameBadge(ctx context.Context, username string) (string, error) {
	userID, err := s.resolveUsernameForPublic(ctx, username)
	if err != nil {
		return "", err
	}

	habitsList, err := listHabits(ctx, s.pool, userID)
	if err != nil {
		return "", err
	}

	if s.visibilityFilter != nil {
		habitIDs := make([]string, len(habitsList))
		for i, hb := range habitsList {
			habitIDs[i] = hb.ID
		}
		visible, err := s.visibilityFilter.VisibleHabitIDs(ctx, userID, habitIDs)
		if err != nil {
			return "", fmt.Errorf("habits: filtering flame badge habits by visibility: %w", err)
		}
		filtered := make([]Habit, 0, len(habitsList))
		for _, hb := range habitsList {
			if visible[hb.ID] {
				filtered = append(filtered, hb)
			}
		}
		habitsList = filtered
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

// HabitSummary is one non-archived habit's cross-module projection — id,
// name, icon, color, current consistency/flame level (UTC "today", the
// share-surface contract every consumer of this method shares) and any
// active, non-expired, IsPublicOnFlame promise. It is the in-process
// replacement for the old GET /habits/user/{userId} internal endpoint other
// services called over HTTP (see habit-service's InternalEndpoints.cs,
// InternalGetUserHabits) — internal/social (friend-list/profile enrichment,
// visibility ownership checks, the witness link viewer) is the sole caller.
type HabitSummary struct {
	ID          string
	Name        string
	Icon        *string
	Color       *string
	Consistency float64
	FlameLevel  string
	Promise     *PublicPromiseResponse
}

// HabitsForUser returns every non-archived habit owned by userID with
// current consistency/flame level and any public promise attached — see
// HabitSummary's doc comment. Always UTC "today" (never a caller-supplied
// timezone), matching the old internal endpoint's share-surface contract;
// callers that need friend-vs-public visibility filtering apply it
// themselves against the returned IDs (this method does no filtering of its
// own — unlike PublicFlameProfile/FlameBadge, it has no single "viewer" to
// filter for, since social calls this once per owner and then filters
// per-viewer).
func (s *Service) HabitsForUser(ctx context.Context, userID string) ([]HabitSummary, error) {
	habitsList, err := listHabits(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}

	habitIDs := make([]string, len(habitsList))
	for i, hb := range habitsList {
		habitIDs[i] = hb.ID
	}
	todayUTC := civilDateInLocation(s.now(), time.UTC)
	promises, err := publicPromisesForHabits(ctx, s.pool, userID, habitIDs, todayUTC)
	if err != nil {
		return nil, err
	}

	out := make([]HabitSummary, len(habitsList))
	for i, hb := range habitsList {
		consistency, err := s.currentConsistency(ctx, hb, time.UTC)
		if err != nil {
			return nil, err
		}
		flame := GetFlameLevel(consistency, nil)

		var promiseResp *PublicPromiseResponse
		if p, ok := promises[hb.ID]; ok {
			r := toPublicPromiseResponse(p, &consistency)
			promiseResp = &r
		}

		out[i] = HabitSummary{
			ID:          hb.ID,
			Name:        hb.Name,
			Icon:        hb.Icon,
			Color:       hb.Color,
			Consistency: consistency,
			FlameLevel:  flame.String(),
			Promise:     promiseResp,
		}
	}
	return out, nil
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

// renderFlameBadgeSVG renders the shareable flame badge (viewBox, paths,
// and color mapping verified in promise_public_test.go's table). The
// consistency percentage is rounded to the nearest integer; username is
// escaped with html.EscapeString, which is safe inside this text node.
func renderFlameBadgeSVG(username string, level FlameLevel, consistency float64) string {
	flameColor, glowColor := flameBadgeColors(level)
	consistencyText := fmt.Sprintf("%d%%", int(math.Round(consistency)))
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
