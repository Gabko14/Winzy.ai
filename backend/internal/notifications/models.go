package notifications

import (
	"encoding/json"
	"strings"
	"time"
)

// NotificationType matches C# NotificationType enum names stored via
// HasConversion<string>() — PascalCase in the DB, lowercased in API responses.
type NotificationType string

const (
	TypeHabitCompleted        NotificationType = "HabitCompleted"
	TypeFriendRequestSent     NotificationType = "FriendRequestSent"
	TypeFriendRequestAccepted NotificationType = "FriendRequestAccepted"
	TypeChallengeCreated      NotificationType = "ChallengeCreated"
	TypeChallengeCompleted    NotificationType = "ChallengeCompleted"
)

const (
	PlatformWebPush  = "web_push"
	PlatformExpoPush = "expo_push"
)

// Notification is one in-app notification row.
type Notification struct {
	ID             string
	UserID         string
	Type           NotificationType
	Data           json.RawMessage
	ReadAt         *time.Time
	IdempotencyKey *string
	PushDelivered  bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// Settings is per-user notification preference flags (defaults all true).
type Settings struct {
	ID               string
	UserID           string
	HabitReminders   bool
	FriendActivity   bool
	ChallengeUpdates bool
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// DeviceToken is a registered push endpoint for a user.
type DeviceToken struct {
	ID        string
	UserID    string
	Platform  string
	Token     string
	DeviceID  *string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// UpdateSettingsRequest is the PUT /notifications/settings body.
type UpdateSettingsRequest struct {
	HabitReminders   *bool
	FriendActivity   *bool
	ChallengeUpdates *bool
}

// RegisterDeviceRequest is the POST /notifications/devices body.
type RegisterDeviceRequest struct {
	Platform string
	Token    string
	DeviceID *string
}

// UnregisterDeviceRequest is the DELETE /notifications/devices body.
type UnregisterDeviceRequest struct {
	DeviceID string
}

type notificationResponse struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	ReadAt    *time.Time      `json:"readAt"`
	CreatedAt time.Time       `json:"createdAt"`
}

type listNotificationsResponse struct {
	Items    []notificationResponse `json:"items"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"pageSize"`
	Total    int                    `json:"total"`
}

type settingsResponse struct {
	HabitReminders   bool `json:"habitReminders"`
	FriendActivity   bool `json:"friendActivity"`
	ChallengeUpdates bool `json:"challengeUpdates"`
}

type unreadCountResponse struct {
	UnreadCount int `json:"unreadCount"`
}

type markedAsReadResponse struct {
	MarkedAsRead int64 `json:"markedAsRead"`
}

type vapidPublicKeyResponse struct {
	PublicKey string `json:"publicKey"`
}

func toNotificationResponse(n Notification) notificationResponse {
	data := n.Data
	if len(data) == 0 || !json.Valid(data) {
		data = json.RawMessage(`{}`)
	}
	return notificationResponse{
		ID:        n.ID,
		Type:      strings.ToLower(string(n.Type)),
		Data:      data,
		ReadAt:    n.ReadAt,
		CreatedAt: n.CreatedAt,
	}
}
