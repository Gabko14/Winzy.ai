package social

import (
	"context"
	"fmt"

	"github.com/Gabko14/winzy/backend/internal/db"
)

// This file is social's export surface for other in-process modules — the
// direct-call replacement for the old /social/internal/friends/{userId},
// /social/internal/friends/{userId1}/{userId2}, and
// /social/internal/visible-habits/{userId} HTTP endpoints (InternalEndpoints.cs/
// VisibilityEndpoints.cs's GetVisibleHabits). None of the three are exposed
// as HTTP routes here — matching how habits.Service never exposed
// /habits/user/{userId} or /habits/internal/* as routes either, only as
// exported Go methods (see habits/promise_public.go's HabitsForUser) — since
// every consumer in this single-process rewrite calls them directly.
// challenges (winzy.ai-rdc7.5) uses AreFriends for challenge-eligibility
// validation; notifications (winzy.ai-rdc7.6) uses FriendIDs for fan-out;
// activity (winzy.ai-rdc7.7) uses VisibleHabitIDsForViewer for feed
// filtering; habits' public flame surfaces use VisibleHabitIDs (below) via
// the habits.PublicVisibilityFilter interface.

// FriendIDs returns every userID's accepted friend's id — the in-process
// replacement for the old GET /social/internal/friends/{userId} endpoint
// (InternalEndpoints.cs's GetFriendIds).
func (s *Service) FriendIDs(ctx context.Context, userID string) ([]string, error) {
	return acceptedFriendIDs(ctx, s.pool, userID)
}

// AreFriends reports whether a and b have an Accepted friendship — the
// in-process replacement for the old GET
// /social/internal/friends/{userId1}/{userId2} endpoint
// (InternalEndpoints.cs's CheckFriendship). Friendship is symmetric (an
// acceptance always creates both direction rows — see
// Service.AcceptFriendRequest), so checking one direction is sufficient.
func (s *Service) AreFriends(ctx context.Context, a, b string) (bool, error) {
	return isAcceptedFriend(ctx, s.pool, a, b)
}

// EnsureFriendship makes sure a and b have an Accepted friendship in both
// directions, joining whatever transaction db.WithQuerier put on ctx
// (falls back to s.pool). Used by challenge-invite claim (winzy.ai-jc38.4).
//
// Implementation is a true upsert per direction
// (`INSERT … ON CONFLICT (user_id, friend_id) DO UPDATE SET status='Accepted'`):
// Pending rows upgrade, Accepted rows stay Accepted, and a unique-violation
// never aborts the caller's Postgres transaction (swallowing 23505 after the
// fact would leave the tx poisoned with 25P02).
//
// Lock order: always upsert (minUUID, maxUUID) before (maxUUID, minUUID),
// regardless of who is creator/claimer. Opposite-direction concurrent claims
// (A claims B's invite while B claims A's) would otherwise take row locks in
// opposite order and deadlock (Postgres 40P01 → 500 on one side).
//
// Deliberately does NOT emit FriendRequestAccepted: claim fires
// ChallengeInviteClaimed for the creator; a second friendship push for the
// same tap is noise (bead winzy.ai-jc38.4).
func (s *Service) EnsureFriendship(ctx context.Context, a, b string) error {
	if a == "" || b == "" || a == b {
		return fmt.Errorf("social: EnsureFriendship requires two distinct user ids")
	}
	q := db.QuerierFrom(ctx, s.pool)
	first, second := a, b
	if a > b {
		first, second = b, a
	}
	if err := upsertAcceptedFriendship(ctx, q, first, second); err != nil {
		return err
	}
	if err := upsertAcceptedFriendship(ctx, q, second, first); err != nil {
		return err
	}
	return nil
}

// VisibleHabitIDsForViewer returns the subset of habitIDs (all owned by
// ownerID) visible to viewerID — pass "" for the anonymous/public viewer.
// This is the general in-process replacement for the old GET
// /social/internal/visible-habits/{userId}?viewer=... endpoint
// (VisibilityEndpoints.cs's GetVisibleHabits), generalized to take the
// candidate habit-id set as a parameter rather than enumerating it itself:
// social has no habit list of its own (habits live in the habits module),
// so a caller that already has one (habits' own public flame surfaces, or a
// future module that already fetched a specific set of habits) passes it in
// directly instead of this method calling back into habits.Service itself
// for a list it may not even need in full.
func (s *Service) VisibleHabitIDsForViewer(ctx context.Context, ownerID string, habitIDs []string, viewerID string) (map[string]bool, error) {
	settings, err := visibilityMapForUser(ctx, s.pool, ownerID)
	if err != nil {
		return nil, err
	}
	def, err := defaultVisibilityFor(ctx, s.pool, ownerID)
	if err != nil {
		return nil, err
	}

	isFriend := false
	if viewerID != "" && viewerID != ownerID {
		isFriend, err = isAcceptedFriend(ctx, s.pool, viewerID, ownerID)
		if err != nil {
			return nil, err
		}
	}

	visible := make(map[string]bool, len(habitIDs))
	for _, habitID := range habitIDs {
		v := effectiveVisibility(settings[habitID], def)
		if visibleToViewer(v, isFriend) {
			visible[habitID] = true
		}
	}
	return visible, nil
}

// VisibleHabitIDs satisfies habits.PublicVisibilityFilter: it is
// VisibleHabitIDsForViewer with the anonymous/public viewer, wired in
// cmd/api/main.go as habits.Service's visibility filter for GET
// /habits/public/{username} and its flame.svg sibling.
func (s *Service) VisibleHabitIDs(ctx context.Context, ownerID string, habitIDs []string) (map[string]bool, error) {
	return s.VisibleHabitIDsForViewer(ctx, ownerID, habitIDs, "")
}
