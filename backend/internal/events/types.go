package events

import "time"

// The 11 event payload types below are the in-process replacement for the
// old NATS subjects (see epic winzy.ai-rdc7 ground truth: user.>, habit.>,
// friend.>, challenge.>, visibility.>). Field names and semantics match the
// old C# event contracts exactly; only the transport changed. IDs are
// plain strings holding a Postgres uuid's canonical text form — see
// internal/auth/store.go for why this codebase carries ids as strings
// rather than adding a UUID library.

// UserRegistered is emitted once a new user row commits.
type UserRegistered struct {
	UserID   string
	Username string
}

// UserDeleted is emitted before an account's row is removed, so every
// registered handler can cascade-delete its own module's data for the user
// in the same transaction (see the DELETE /auth/account handler).
type UserDeleted struct {
	UserID string
}

// HabitCreated is emitted when a new habit is created.
type HabitCreated struct {
	UserID  string
	HabitID string
	Name    string
}

// CompletionKind mirrors the old CompletionKind string enum
// (None/Full/Minimum).
type CompletionKind string

// HabitCompleted is emitted when a completion is recorded for a habit.
// Timezone, DisplayName and HabitName are optional enrichment fields the
// old event payload carried for downstream consumers (notifications,
// activity feed) that don't have their own copy of that data.
type HabitCompleted struct {
	UserID         string
	HabitID        string
	Date           time.Time
	Consistency    float64
	Timezone       string
	DisplayName    string
	HabitName      string
	CompletionKind CompletionKind
}

// HabitArchived is emitted when a habit is soft-archived.
type HabitArchived struct {
	UserID  string
	HabitID string
}

// FriendRequestSent is emitted when a friend request is created.
type FriendRequestSent struct {
	From string
	To   string
}

// FriendRequestAccepted is emitted when a pending friend request is
// accepted, creating the bidirectional friendship.
type FriendRequestAccepted struct {
	UserID1 string
	UserID2 string
}

// FriendRemoved is emitted when either side of a friendship removes it.
type FriendRemoved struct {
	UserID1 string
	UserID2 string
}

// VisibilityChanged is emitted when a habit's sharing visibility changes.
type VisibilityChanged struct {
	UserID  string
	HabitID string
	Old     string
	New     string
}

// ChallengeCreated is emitted when a challenge is created between friends.
type ChallengeCreated struct {
	ChallengeID string
	From        string
	To          string
	HabitID     string
}

// ChallengeInviteClaimed is emitted after a challenge invite is claimed
// (post-commit). Notifications notify the CREATOR — distinct from
// ChallengeCreated, which notifies the recipient ("Someone challenged you").
type ChallengeInviteClaimed struct {
	InviteID    string
	ChallengeID string
	CreatorID   string
	ClaimerID   string
	HabitName   string
}

// ChallengeCompleted is emitted when a challenge's milestone is reached.
type ChallengeCompleted struct {
	ChallengeID string
	UserID      string
	Reward      string
}
