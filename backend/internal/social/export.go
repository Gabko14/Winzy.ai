package social

import (
	"context"
	"fmt"
	"time"

	"github.com/Gabko14/winzy/backend/internal/export"
)

// friendExport/pendingRequestExport/visibilitySettingExport mirror
// ExportUserData's three anonymous projections in InternalEndpoints.cs
// field-for-field.
type friendExport struct {
	FriendUserID string    `json:"friendUserId"`
	ConnectedAt  time.Time `json:"connectedAt"`
}

type pendingRequestExport struct {
	Direction   string    `json:"direction"`
	OtherUserID string    `json:"otherUserId"`
	RequestedAt time.Time `json:"requestedAt"`
}

type visibilitySettingExport struct {
	HabitID    string `json:"habitId"`
	Visibility string `json:"visibility"`
}

type preferencesExport struct {
	DefaultHabitVisibility string `json:"defaultHabitVisibility"`
}

// witnessLinkExport is a genuine addition over InternalExport in
// InternalEndpoints.cs, which never exported witness link data at all — the
// same class of gap-fill the habits module's own export.go documents for
// promises (PM REVIEW ADDENDUM on winzy.ai-rdc7.4): a user's Witness Links
// are their own data (a share credential and a private label), so omitting
// them from their own data export would silently under-export. Every link
// is included regardless of revocation (a complete export, not just active
// links); Token is included since this is the user exporting their OWN
// data, the same principle that makes PromiseResponse (owner-facing,
// includes PrivateNote) different from PublicPromiseResponse.
type witnessLinkExport struct {
	ID        string    `json:"id"`
	Token     string    `json:"token"`
	Label     *string   `json:"label"`
	HabitIDs  []string  `json:"habitIds"`
	Revoked   bool      `json:"revoked"`
	CreatedAt time.Time `json:"createdAt"`
}

type socialExportData struct {
	Friends            []friendExport            `json:"friends"`
	PendingRequests    []pendingRequestExport    `json:"pendingRequests"`
	Preferences        preferencesExport         `json:"preferences"`
	VisibilitySettings []visibilitySettingExport `json:"visibilitySettings"`
	WitnessLinks       []witnessLinkExport       `json:"witnessLinks"`
}

// exportSection builds userID's full social-module export, matching
// ExportUserData in InternalEndpoints.cs field-for-field for friends/
// pendingRequests/preferences/visibilitySettings, plus witnessLinks (see
// witnessLinkExport's doc comment). Registered under "social" in NewService.
//
// Returns export.ErrNoData when the user has no friendships, preferences,
// visibility settings, OR witness links — extending ExportUserData's
// `!hasFriendships && !hasPreferences && !hasVisibility` condition with the
// witness-links addition for the same reason the data itself was added.
func (s *Service) exportSection(ctx context.Context, userID string) (any, error) {
	hasFriendships, err := hasAnyFriendship(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	_, hasPreference, err := findPreference(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	settings, err := listVisibilitySettings(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	links, err := allWitnessLinksForExport(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}

	if !hasFriendships && !hasPreference && len(settings) == 0 && len(links) == 0 {
		return nil, export.ErrNoData
	}

	accepted, err := acceptedFriendsForExport(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	friends := make([]friendExport, len(accepted))
	for i, f := range accepted {
		friends[i] = friendExport{FriendUserID: f.FriendID, ConnectedAt: f.CreatedAt}
	}

	pending, err := pendingRequestsInvolvingUser(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}

	defaultVisibility, err := defaultVisibilityFor(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}

	visibilityOut := make([]visibilitySettingExport, len(settings))
	for i, v := range settings {
		visibilityOut[i] = visibilitySettingExport{HabitID: v.HabitID, Visibility: v.Visibility.String()}
	}

	linkIDs := make([]string, len(links))
	for i, l := range links {
		linkIDs[i] = l.ID
	}
	habitMap, err := witnessLinkHabitIDsForLinks(ctx, s.pool, linkIDs)
	if err != nil {
		return nil, err
	}
	linksOut := make([]witnessLinkExport, len(links))
	for i, l := range links {
		linksOut[i] = witnessLinkExport{
			ID: l.ID, Token: l.Token, Label: l.Label,
			HabitIDs: habitMap[l.ID], Revoked: l.RevokedAt != nil, CreatedAt: l.CreatedAt,
		}
	}

	return socialExportData{
		Friends:            friends,
		PendingRequests:    pending,
		Preferences:        preferencesExport{DefaultHabitVisibility: defaultVisibility.String()},
		VisibilitySettings: visibilityOut,
		WitnessLinks:       linksOut,
	}, nil
}

// acceptedFriendsForExport returns every accepted friendship for userID,
// oldest first and uncapped — matching ExportUserData's
// `.OrderBy(f => f.CreatedAt).ToListAsync()` in InternalEndpoints.cs exactly
// (ascending, no page size at all). This is deliberately a dedicated query
// rather than reusing listAcceptedFriends (store.go), which is
// DESC-ordered and paginated for GET /social/friends's own contract — a
// data export must never silently truncate or reorder a user's own data.
func acceptedFriendsForExport(ctx context.Context, db querier, userID string) ([]Friendship, error) {
	return queryFriendships(ctx, db, `
		SELECT `+friendshipColumns+` FROM friendships
		WHERE user_id = $1::uuid AND status = 'Accepted'
		ORDER BY created_at`, userID)
}

func hasAnyFriendship(ctx context.Context, db querier, userID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM friendships WHERE user_id = $1::uuid OR friend_id = $1::uuid)`,
		userID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("social: checking friendship existence: %w", err)
	}
	return exists, nil
}

// pendingRequestsInvolvingUser returns every Pending friendship touching
// userID (sent or received), oldest first, matching ExportUserData's
// pendingRequests projection (direction = "sent" when userID is the sender).
func pendingRequestsInvolvingUser(ctx context.Context, db querier, userID string) ([]pendingRequestExport, error) {
	rows, err := db.Query(ctx, `
		SELECT user_id::text, friend_id::text, created_at FROM friendships
		WHERE (user_id = $1::uuid OR friend_id = $1::uuid) AND status = 'Pending'
		ORDER BY created_at`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("social: listing pending requests for export: %w", err)
	}
	defer rows.Close()

	result := []pendingRequestExport{}
	for rows.Next() {
		var sender, recipient string
		var createdAt time.Time
		if err := rows.Scan(&sender, &recipient, &createdAt); err != nil {
			return nil, fmt.Errorf("social: scanning pending request for export: %w", err)
		}
		entry := pendingRequestExport{RequestedAt: createdAt}
		if sender == userID {
			entry.Direction = "sent"
			entry.OtherUserID = recipient
		} else {
			entry.Direction = "received"
			entry.OtherUserID = sender
		}
		result = append(result, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("social: iterating pending requests for export: %w", err)
	}
	return result, nil
}

// allWitnessLinksForExport returns every witness link userID owns,
// regardless of revocation, oldest first.
func allWitnessLinksForExport(ctx context.Context, db querier, userID string) ([]WitnessLink, error) {
	rows, err := db.Query(ctx, `
		SELECT `+witnessLinkColumns+` FROM witness_links WHERE owner_id = $1::uuid ORDER BY created_at`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("social: listing witness links for export: %w", err)
	}
	defer rows.Close()

	result := []WitnessLink{}
	for rows.Next() {
		w, err := scanWitnessLink(rows)
		if err != nil {
			return nil, fmt.Errorf("social: scanning witness link for export: %w", err)
		}
		result = append(result, w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("social: iterating witness links for export: %w", err)
	}
	return result, nil
}
