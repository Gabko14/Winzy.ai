package notifications

import (
	"context"

	"github.com/Gabko14/winzy/backend/internal/export"
)

type notificationExportData struct {
	Settings      settingsResponse       `json:"settings"`
	Notifications []notificationResponse `json:"notifications"`
}

// exportSection matches Program.cs's GET /notifications/internal/export/{userId}:
// service name is the singular literal "notification"; ErrNoData when neither
// settings nor notifications exist (old 404). Device tokens are intentionally
// omitted — the C# export never included them.
func (s *Service) exportSection(ctx context.Context, userID string) (any, error) {
	has, err := hasAnyNotificationData(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	if !has {
		return nil, export.ErrNoData
	}

	settings, found, err := getSettings(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	settingsResp := settingsResponse{
		HabitReminders:   true,
		FriendActivity:   true,
		ChallengeUpdates: true,
	}
	if found {
		settingsResp = settingsResponse{
			HabitReminders:   settings.HabitReminders,
			FriendActivity:   settings.FriendActivity,
			ChallengeUpdates: settings.ChallengeUpdates,
		}
	}

	items, err := listNotificationsForExport(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	out := make([]notificationResponse, len(items))
	for i, n := range items {
		out[i] = toNotificationResponse(n)
	}
	return notificationExportData{Settings: settingsResp, Notifications: out}, nil
}
