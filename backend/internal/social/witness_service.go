package social

// Witness Links are anonymous, tokenized share links scoped to a per-owner
// habit allowlist — the "grab a link, send it to Coach Sam" sharing
// surface. The token IS the access credential (see WitnessLink's doc
// comment in models.go): every method below that resolves a link by token
// logs only the resolved link id and owner id, NEVER the token value itself
// (PM REVIEW ADDENDUM on winzy.ai-rdc7.4).

import (
	"context"
	"fmt"
)

// minWitnessTokenLength/maxWitnessTokenLength bound ViewWitnessLink's
// early-reject check — a valid token is exactly 43 characters (32
// base64url-encoded bytes, no padding); this range matches
// WitnessLinkEndpoints.cs's `token.Length < 20 || token.Length > 64` exactly
// (deliberately looser than the exact length, per that check's own comment).
const (
	minWitnessTokenLength = 20
	maxWitnessTokenLength = 64
)

// dedupeStrings returns ids with duplicates removed, preserving first-seen
// order — matching `request.HabitIds.Distinct()` in
// WitnessLinkEndpoints.cs.
func dedupeStrings(ids []string) []string {
	seen := make(map[string]bool, len(ids))
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}

// CreateWitnessLink mints a fresh token and habit allowlist for userID,
// matching CreateWitnessLink in WitnessLinkEndpoints.cs: the raw (untrimmed)
// label length and the raw (pre-dedup) habitIDs count are validated first,
// matching the C#'s validation-before-transformation order exactly.
func (s *Service) CreateWitnessLink(ctx context.Context, userID string, label *string, habitIDs []string) (WitnessLink, []string, error) {
	if err := validateWitnessLabel(label); err != nil {
		return WitnessLink{}, nil, err
	}
	if err := validateWitnessHabitCount(habitIDs); err != nil {
		return WitnessLink{}, nil, err
	}

	token, err := generateWitnessToken()
	if err != nil {
		return WitnessLink{}, nil, err
	}

	// The link row and its habit allowlist commit as one unit: without a
	// transaction, a failure after the link insert (e.g. an allowlist insert
	// erroring out) would persist a "ghost" active, tokenable link with a
	// partial or empty allowlist instead of nothing at all.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WitnessLink{}, nil, fmt.Errorf("social: beginning create-witness-link transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	link, err := insertWitnessLink(ctx, tx, userID, token, trimPtr(label))
	if err != nil {
		return WitnessLink{}, nil, err
	}

	uniqueIDs := dedupeStrings(habitIDs)
	if len(uniqueIDs) > 0 {
		if err := insertWitnessLinkHabits(ctx, tx, link.ID, uniqueIDs); err != nil {
			return WitnessLink{}, nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return WitnessLink{}, nil, fmt.Errorf("social: committing create-witness-link transaction: %w", err)
	}

	s.logger.InfoContext(ctx, "witness link created", "link_id", link.ID, "owner_id", userID)
	return link, uniqueIDs, nil
}

// ListWitnessLinks returns userID's non-revoked witness links (newest
// first) plus each link's habit allowlist, matching ListWitnessLinks in
// WitnessLinkEndpoints.cs.
func (s *Service) ListWitnessLinks(ctx context.Context, userID string) ([]WitnessLink, map[string][]string, error) {
	links, err := listActiveWitnessLinksByOwner(ctx, s.pool, userID)
	if err != nil {
		return nil, nil, err
	}
	linkIDs := make([]string, len(links))
	for i, l := range links {
		linkIDs[i] = l.ID
	}
	habitMap, err := witnessLinkHabitIDsForLinks(ctx, s.pool, linkIDs)
	if err != nil {
		return nil, nil, err
	}
	return links, habitMap, nil
}

// UpdateWitnessLink applies label/habit-allowlist changes to a link owned by
// userID (404 for another owner's or a revoked link), matching
// UpdateWitnessLink in WitnessLinkEndpoints.cs: a non-nil HabitIDs replaces
// the entire allowlist; a nil one leaves it untouched.
// UpdateWitnessLink's validation order matches UpdateWitnessLink in
// WitnessLinkEndpoints.cs exactly: decoded body -> label length check ->
// link lookup (404 for another owner's or a revoked link) -> habitIds count
// check. The habit-count check runs AFTER the ownership lookup so a
// request for a foreign (or already-revoked) link with 51 habitIds 404s,
// not 400s — the C# source never even reaches its own Count check for a
// link it can't find.
func (s *Service) UpdateWitnessLink(ctx context.Context, userID, id string, label *string, habitIDs []string, replaceHabits bool) (WitnessLink, []string, error) {
	if !isValidUUID(id) {
		return WitnessLink{}, nil, ErrNotFound
	}
	if err := validateWitnessLabel(label); err != nil {
		return WitnessLink{}, nil, err
	}

	// The label update and the allowlist replace commit as one unit: without
	// a transaction, the replace path (DELETE then INSERTs) could die
	// half-way and leave a corrupted (partially replaced) allowlist.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WitnessLink{}, nil, fmt.Errorf("social: beginning update-witness-link transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	link, found, err := findActiveWitnessLinkByOwner(ctx, tx, id, userID)
	if err != nil {
		return WitnessLink{}, nil, err
	}
	if !found {
		return WitnessLink{}, nil, ErrNotFound
	}

	if replaceHabits {
		if err := validateWitnessHabitCount(habitIDs); err != nil {
			return WitnessLink{}, nil, err
		}
	}

	if label != nil {
		link, err = updateWitnessLinkLabel(ctx, tx, id, *trimPtr(label))
		if err != nil {
			return WitnessLink{}, nil, err
		}
	}

	var resultHabitIDs []string
	if replaceHabits {
		resultHabitIDs = dedupeStrings(habitIDs)
		if err := replaceWitnessLinkHabits(ctx, tx, id, resultHabitIDs); err != nil {
			return WitnessLink{}, nil, err
		}
	} else {
		resultHabitIDs, err = witnessLinkHabitIDs(ctx, tx, id)
		if err != nil {
			return WitnessLink{}, nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return WitnessLink{}, nil, fmt.Errorf("social: committing update-witness-link transaction: %w", err)
	}

	s.logger.InfoContext(ctx, "witness link updated", "link_id", id, "owner_id", userID)
	return link, resultHabitIDs, nil
}

// RevokeWitnessLink soft-deletes a link owned by userID, matching
// RevokeWitnessLink in WitnessLinkEndpoints.cs (404 for another owner's or
// an already-revoked link).
func (s *Service) RevokeWitnessLink(ctx context.Context, userID, id string) error {
	if !isValidUUID(id) {
		return ErrNotFound
	}
	link, found, err := findActiveWitnessLinkByOwner(ctx, s.pool, id, userID)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}
	if err := revokeWitnessLinkRow(ctx, s.pool, link.ID); err != nil {
		return err
	}
	s.logger.InfoContext(ctx, "witness link revoked", "link_id", id, "owner_id", userID)
	return nil
}

// RotateToken mints a fresh token for a link owned by userID, immediately
// invalidating the old one, matching RotateToken in
// WitnessLinkEndpoints.cs. Label and the habit allowlist are unchanged.
func (s *Service) RotateToken(ctx context.Context, userID, id string) (WitnessLink, []string, error) {
	if !isValidUUID(id) {
		return WitnessLink{}, nil, ErrNotFound
	}
	_, found, err := findActiveWitnessLinkByOwner(ctx, s.pool, id, userID)
	if err != nil {
		return WitnessLink{}, nil, err
	}
	if !found {
		return WitnessLink{}, nil, ErrNotFound
	}

	newToken, err := generateWitnessToken()
	if err != nil {
		return WitnessLink{}, nil, err
	}
	rotated, err := rotateWitnessLinkToken(ctx, s.pool, id, newToken)
	if err != nil {
		return WitnessLink{}, nil, err
	}

	habitIDs, err := witnessLinkHabitIDs(ctx, s.pool, id)
	if err != nil {
		return WitnessLink{}, nil, err
	}

	s.logger.InfoContext(ctx, "witness link token rotated", "link_id", id, "owner_id", userID)
	return rotated, habitIDs, nil
}

// ViewWitnessLink resolves an anonymous witness view: a constant-time 404
// for both an unknown token and a revoked one (findWitnessLinkByToken never
// filters on revoked_at at the SQL level — the RevokedAt check happens here,
// in Go, after an identical query/index-lookup shape for either outcome — so
// there is no timing oracle distinguishing "never existed" from "revoked"),
// matching ViewWitnessLink in WitnessLinkEndpoints.cs. Habits are filtered to
// the link's per-habit allowlist only — visibility_settings/preferences are
// never consulted here; the witness link's own allowlist IS the access
// control for this surface. habitsUnavailable degrades gracefully (matching
// ListFriends/FriendProfile's contract) if habits.Service errors; an
// auth.Service profile-lookup failure degrades owner info to null instead of
// failing the whole view, matching the C#'s separate try/catch around that
// specific enrichment call.
func (s *Service) ViewWitnessLink(ctx context.Context, token string) (witnessViewResponse, error) {
	if len(token) < minWitnessTokenLength || len(token) > maxWitnessTokenLength {
		return witnessViewResponse{}, ErrNotFound
	}

	link, found, err := findWitnessLinkByToken(ctx, s.pool, token)
	if err != nil {
		return witnessViewResponse{}, err
	}
	if !found || link.RevokedAt != nil {
		return witnessViewResponse{}, ErrNotFound
	}

	allowedIDs, err := witnessLinkHabitIDs(ctx, s.pool, link.ID)
	if err != nil {
		return witnessViewResponse{}, err
	}
	allowed := make(map[string]bool, len(allowedIDs))
	for _, id := range allowedIDs {
		allowed[id] = true
	}

	summaries, err := s.habits.HabitsForUser(ctx, link.OwnerID)
	habitsUnavailable := false
	if err != nil {
		summaries = nil
		habitsUnavailable = true
	}

	habitsOut := []witnessHabitEntry{}
	for _, hb := range summaries {
		if !allowed[hb.ID] {
			continue
		}
		var promise any
		if hb.Promise != nil {
			promise = hb.Promise
		}
		habitsOut = append(habitsOut, witnessHabitEntry{
			ID: hb.ID, Name: hb.Name, Icon: hb.Icon, Color: hb.Color,
			Consistency: hb.Consistency, FlameLevel: hb.FlameLevel, Promise: promise,
		})
	}

	var ownerUsername, ownerDisplayName *string
	if profiles, err := s.auth.BatchProfiles(ctx, []string{link.OwnerID}); err != nil {
		s.logger.WarnContext(ctx, "failed to fetch owner profile for witness link", "link_id", link.ID, "error", err)
	} else if len(profiles) > 0 {
		username := profiles[0].Username
		ownerUsername = &username
		ownerDisplayName = profiles[0].DisplayName
	}

	s.logger.InfoContext(ctx, "witness link accessed", "link_id", link.ID, "owner_id", link.OwnerID, "habits_shown", len(habitsOut))

	return witnessViewResponse{
		OwnerUsername:     ownerUsername,
		OwnerDisplayName:  ownerDisplayName,
		Habits:            habitsOut,
		HabitsUnavailable: habitsUnavailable,
	}, nil
}
