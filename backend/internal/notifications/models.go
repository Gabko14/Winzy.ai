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
	TypeChallengeAccepted     NotificationType = "ChallengeAccepted"
	TypeChallengeCompleted    NotificationType = "ChallengeCompleted"
	TypeHabitReminder         NotificationType = "HabitReminder"
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
// ReminderTime/ReminderTimezone drive the daily habit-reminder ticker only —
// they are never used for completion or stats timezone math.
type Settings struct {
	ID               string
	UserID           string
	HabitReminders   bool
	FriendActivity   bool
	ChallengeUpdates bool
	ReminderTime     time.Time // wall-clock HH:MM (date component ignored)
	ReminderTimezone *string   // IANA name; nil = never learned, send nothing
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
	ReminderTime     *string
	ReminderTimezone optionalTimezone
}

// optionalTimezone distinguishes omitted vs explicit null (clear) vs value.
type optionalTimezone struct {
	set   bool
	value *string
}

func (o *optionalTimezone) UnmarshalJSON(data []byte) error {
	o.set = true
	if string(data) == "null" {
		o.value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	o.value = &s
	return nil
}

// ReminderTimezoneValue marks reminderTimezone as present with tz.
func ReminderTimezoneValue(tz string) optionalTimezone {
	t := tz
	return optionalTimezone{set: true, value: &t}
}

// ReminderTimezoneClear marks reminderTimezone as an explicit JSON null.
func ReminderTimezoneClear() optionalTimezone {
	return optionalTimezone{set: true, value: nil}
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
	HabitReminders   bool    `json:"habitReminders"`
	FriendActivity   bool    `json:"friendActivity"`
	ChallengeUpdates bool    `json:"challengeUpdates"`
	ReminderTime     string  `json:"reminderTime"`
	ReminderTimezone *string `json:"reminderTimezone"`
}

func defaultReminderTime() time.Time {
	return time.Date(0, 1, 1, 19, 0, 0, 0, time.UTC)
}

func formatReminderTime(t time.Time) string {
	return t.Format("15:04")
}

func toSettingsResponse(s Settings) settingsResponse {
	return settingsResponse{
		HabitReminders:   s.HabitReminders,
		FriendActivity:   s.FriendActivity,
		ChallengeUpdates: s.ChallengeUpdates,
		ReminderTime:     formatReminderTime(s.ReminderTime),
		ReminderTimezone: s.ReminderTimezone,
	}
}

func defaultSettingsResponse() settingsResponse {
	return settingsResponse{
		HabitReminders:   true,
		FriendActivity:   true,
		ChallengeUpdates: true,
		ReminderTime:     "19:00",
		ReminderTimezone: nil,
	}
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
