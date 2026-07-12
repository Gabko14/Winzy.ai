// Package activity ports activity-service's friends activity feed
// (winzy.ai-rdc7.7). In the old NATS world nine subscribers wrote feed
// entries; here they are hook handlers on the shared events.Registry.
// Actor names are joined at read time via auth.BatchProfiles (the
// documented simplification that drops ActorUsername/ActorDisplayName
// columns and ActorNameBackfillJob). Habit visibility filtering uses
// social.FriendIDs + social.VisibleHabitIDsForViewer.
package activity

import (
	"encoding/json"
	"time"
)

// Event-type literals match Subjects.cs / the frontend FeedEventType union.
const (
	EventUserRegistered        = "user.registered"
	EventHabitCreated          = "habit.created"
	EventHabitCompleted        = "habit.completed"
	EventFriendRequestAccepted = "friend.request.accepted"
	EventChallengeCreated      = "challenge.created"
	EventChallengeCompleted    = "challenge.completed"
)

// FeedEntry mirrors the feed_entries table (simplified — no actor name
// columns; those come from the read-time profile join).
type FeedEntry struct {
	ID             string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ActorID        string
	EventType      string
	Data           json.RawMessage
	IdempotencyKey *string
	DeletedAt      *time.Time
}

// FeedEntryResponse is the enriched wire shape matching FeedEntryDto in
// Program.cs / frontend FeedEntry — field-for-field.
type FeedEntryResponse struct {
	ID               string          `json:"id"`
	ActorID          string          `json:"actorId"`
	ActorUsername    *string         `json:"actorUsername"`
	ActorDisplayName *string         `json:"actorDisplayName"`
	EventType        string          `json:"eventType"`
	Data             json.RawMessage `json:"data"`
	CreatedAt        time.Time       `json:"createdAt"`
}

// FeedPage matches the GET /activity/feed response body.
type FeedPage struct {
	Items      []FeedEntryResponse `json:"items"`
	NextCursor *string             `json:"nextCursor"`
	HasMore    bool                `json:"hasMore"`
}
