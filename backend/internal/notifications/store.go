package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var ErrNotFound = errors.New("notifications: not found")

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func isValidUUID(s string) bool {
	return uuidPattern.MatchString(s)
}

const notificationColumns = `id::text, created_at, updated_at, user_id::text, type, data, read_at, idempotency_key, push_delivered`

func scanNotification(row pgx.Row) (Notification, error) {
	var n Notification
	var typ string
	var data []byte
	err := row.Scan(
		&n.ID, &n.CreatedAt, &n.UpdatedAt, &n.UserID, &typ, &data,
		&n.ReadAt, &n.IdempotencyKey, &n.PushDelivered,
	)
	if err != nil {
		return Notification{}, err
	}
	n.Type = NotificationType(typ)
	n.Data = json.RawMessage(data)
	return n, nil
}

func listNotifications(ctx context.Context, db querier, userID string, page, pageSize int) ([]Notification, int, error) {
	var total int
	if err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM notifications WHERE user_id = $1::uuid`, userID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("notifications: counting: %w", err)
	}

	offset := (page - 1) * pageSize
	rows, err := db.Query(ctx, `
		SELECT `+notificationColumns+`
		FROM notifications
		WHERE user_id = $1::uuid
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`, userID, pageSize, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("notifications: listing: %w", err)
	}
	defer rows.Close()

	var out []Notification
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("notifications: scanning list row: %w", err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("notifications: iterating list: %w", err)
	}
	if out == nil {
		out = []Notification{}
	}
	return out, total, nil
}

func getNotificationForUser(ctx context.Context, db querier, id, userID string) (Notification, error) {
	n, err := scanNotification(db.QueryRow(ctx, `
		SELECT `+notificationColumns+`
		FROM notifications
		WHERE id = $1::uuid AND user_id = $2::uuid`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Notification{}, ErrNotFound
	}
	if err != nil {
		return Notification{}, fmt.Errorf("notifications: getting: %w", err)
	}
	return n, nil
}

func markNotificationRead(ctx context.Context, db querier, id, userID string, now time.Time) (Notification, error) {
	n, err := getNotificationForUser(ctx, db, id, userID)
	if err != nil {
		return Notification{}, err
	}
	if n.ReadAt == nil {
		tag, err := db.Exec(ctx, `
			UPDATE notifications
			SET read_at = $3, updated_at = $3
			WHERE id = $1::uuid AND user_id = $2::uuid AND read_at IS NULL`,
			id, userID, now)
		if err != nil {
			return Notification{}, fmt.Errorf("notifications: marking read: %w", err)
		}
		if tag.RowsAffected() > 0 {
			n.ReadAt = &now
			n.UpdatedAt = now
		}
	}
	return n, nil
}

func markAllRead(ctx context.Context, db querier, userID string, now time.Time) (int64, error) {
	tag, err := db.Exec(ctx, `
		UPDATE notifications
		SET read_at = $2, updated_at = $2
		WHERE user_id = $1::uuid AND read_at IS NULL`, userID, now)
	if err != nil {
		return 0, fmt.Errorf("notifications: marking all read: %w", err)
	}
	return tag.RowsAffected(), nil
}

func unreadCount(ctx context.Context, db querier, userID string) (int, error) {
	var count int
	if err := db.QueryRow(ctx, `
		SELECT COUNT(*) FROM notifications
		WHERE user_id = $1::uuid AND read_at IS NULL`, userID).Scan(&count); err != nil {
		return 0, fmt.Errorf("notifications: unread count: %w", err)
	}
	return count, nil
}

func getSettings(ctx context.Context, db querier, userID string) (Settings, bool, error) {
	var s Settings
	err := db.QueryRow(ctx, `
		SELECT id::text, created_at, updated_at, user_id::text,
			habit_reminders, friend_activity, challenge_updates,
			reminder_time, reminder_timezone
		FROM notification_settings WHERE user_id = $1::uuid`, userID).Scan(
		&s.ID, &s.CreatedAt, &s.UpdatedAt, &s.UserID,
		&s.HabitReminders, &s.FriendActivity, &s.ChallengeUpdates,
		&s.ReminderTime, &s.ReminderTimezone,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{}, false, nil
	}
	if err != nil {
		return Settings{}, false, fmt.Errorf("notifications: getting settings: %w", err)
	}
	return s, true, nil
}

func upsertSettings(ctx context.Context, db querier, userID string, req UpdateSettingsRequest, now time.Time) (Settings, error) {
	s, found, err := getSettings(ctx, db, userID)
	if err != nil {
		return Settings{}, err
	}
	if !found {
		s = Settings{
			UserID:           userID,
			HabitReminders:   true,
			FriendActivity:   true,
			ChallengeUpdates: true,
			ReminderTime:     defaultReminderTime(),
		}
	}
	if req.HabitReminders != nil {
		s.HabitReminders = *req.HabitReminders
	}
	if req.FriendActivity != nil {
		s.FriendActivity = *req.FriendActivity
	}
	if req.ChallengeUpdates != nil {
		s.ChallengeUpdates = *req.ChallengeUpdates
	}
	if req.ReminderTime != nil {
		t, err := parseReminderTime(*req.ReminderTime)
		if err != nil {
			return Settings{}, err
		}
		s.ReminderTime = t
	}
	if req.ReminderTimezone.set {
		if req.ReminderTimezone.value == nil {
			s.ReminderTimezone = nil
		} else {
			tz := strings.TrimSpace(*req.ReminderTimezone.value)
			if tz == "" {
				s.ReminderTimezone = nil
			} else {
				s.ReminderTimezone = &tz
			}
		}
	}

	if found {
		_, err = db.Exec(ctx, `
			UPDATE notification_settings
			SET habit_reminders = $2, friend_activity = $3, challenge_updates = $4,
				reminder_time = $5, reminder_timezone = $6, updated_at = $7
			WHERE user_id = $1::uuid`,
			userID, s.HabitReminders, s.FriendActivity, s.ChallengeUpdates,
			s.ReminderTime, s.ReminderTimezone, now)
		if err != nil {
			return Settings{}, fmt.Errorf("notifications: updating settings: %w", err)
		}
		s.UpdatedAt = now
		return s, nil
	}

	err = db.QueryRow(ctx, `
		INSERT INTO notification_settings (
			user_id, habit_reminders, friend_activity, challenge_updates,
			reminder_time, reminder_timezone
		)
		VALUES ($1::uuid, $2, $3, $4, $5, $6)
		RETURNING id::text, created_at, updated_at, user_id::text,
			habit_reminders, friend_activity, challenge_updates,
			reminder_time, reminder_timezone`,
		userID, s.HabitReminders, s.FriendActivity, s.ChallengeUpdates,
		s.ReminderTime, s.ReminderTimezone,
	).Scan(&s.ID, &s.CreatedAt, &s.UpdatedAt, &s.UserID,
		&s.HabitReminders, &s.FriendActivity, &s.ChallengeUpdates,
		&s.ReminderTime, &s.ReminderTimezone)
	if err != nil {
		return Settings{}, fmt.Errorf("notifications: inserting settings: %w", err)
	}
	return s, nil
}

type reminderCandidate struct {
	UserID           string
	ReminderTime     time.Time
	ReminderTimezone string
}

func listReminderCandidates(ctx context.Context, db querier) ([]reminderCandidate, error) {
	rows, err := db.Query(ctx, `
		SELECT user_id::text, reminder_time, reminder_timezone
		FROM notification_settings
		WHERE habit_reminders = true AND reminder_timezone IS NOT NULL`)
	if err != nil {
		return nil, fmt.Errorf("notifications: listing reminder candidates: %w", err)
	}
	defer rows.Close()

	var out []reminderCandidate
	for rows.Next() {
		var c reminderCandidate
		if err := rows.Scan(&c.UserID, &c.ReminderTime, &c.ReminderTimezone); err != nil {
			return nil, fmt.Errorf("notifications: scanning reminder candidate: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("notifications: iterating reminder candidates: %w", err)
	}
	return out, nil
}

func settingsMapForUsers(ctx context.Context, db querier, userIDs []string) (map[string]Settings, error) {
	out := make(map[string]Settings, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx, `
		SELECT id::text, created_at, updated_at, user_id::text,
			habit_reminders, friend_activity, challenge_updates
		FROM notification_settings
		WHERE user_id = ANY($1::uuid[])`, userIDs)
	if err != nil {
		return nil, fmt.Errorf("notifications: batch settings: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var s Settings
		if err := rows.Scan(&s.ID, &s.CreatedAt, &s.UpdatedAt, &s.UserID,
			&s.HabitReminders, &s.FriendActivity, &s.ChallengeUpdates); err != nil {
			return nil, fmt.Errorf("notifications: scanning settings: %w", err)
		}
		out[s.UserID] = s
	}
	return out, rows.Err()
}

func registerDevice(ctx context.Context, db querier, userID string, req RegisterDeviceRequest, now time.Time) error {
	var deviceID *string
	if req.DeviceID != nil {
		trimmed := strings.TrimSpace(*req.DeviceID)
		if trimmed != "" {
			deviceID = &trimmed
		}
	}

	if deviceID != nil {
		tag, err := db.Exec(ctx, `
			UPDATE device_tokens
			SET token = $3, platform = $4, updated_at = $5
			WHERE user_id = $1::uuid AND device_id = $2`,
			userID, *deviceID, req.Token, req.Platform, now)
		if err != nil {
			return fmt.Errorf("notifications: updating device: %w", err)
		}
		if tag.RowsAffected() > 0 {
			return nil
		}
	}

	_, err := db.Exec(ctx, `
		INSERT INTO device_tokens (user_id, platform, token, device_id)
		VALUES ($1::uuid, $2, $3, $4)`,
		userID, req.Platform, req.Token, deviceID)
	if err != nil {
		return fmt.Errorf("notifications: inserting device: %w", err)
	}
	return nil
}

func unregisterDevice(ctx context.Context, db querier, userID, deviceID string) (bool, error) {
	tag, err := db.Exec(ctx, `
		DELETE FROM device_tokens
		WHERE user_id = $1::uuid AND device_id = $2`, userID, deviceID)
	if err != nil {
		return false, fmt.Errorf("notifications: deleting device: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func listDeviceTokens(ctx context.Context, db querier, userID string) ([]DeviceToken, error) {
	rows, err := db.Query(ctx, `
		SELECT id::text, created_at, updated_at, user_id::text, platform, token, device_id
		FROM device_tokens WHERE user_id = $1::uuid`, userID)
	if err != nil {
		return nil, fmt.Errorf("notifications: listing devices: %w", err)
	}
	defer rows.Close()
	var out []DeviceToken
	for rows.Next() {
		var t DeviceToken
		if err := rows.Scan(&t.ID, &t.CreatedAt, &t.UpdatedAt, &t.UserID, &t.Platform, &t.Token, &t.DeviceID); err != nil {
			return nil, fmt.Errorf("notifications: scanning device: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func deleteDeviceToken(ctx context.Context, db querier, id string) error {
	_, err := db.Exec(ctx, `DELETE FROM device_tokens WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("notifications: deleting device by id: %w", err)
	}
	return nil
}

// insertNotificationIdempotent inserts a notification; on unique conflict on
// idempotency_key it returns the existing row and inserted=false.
func insertNotificationIdempotent(ctx context.Context, db querier, n Notification) (Notification, bool, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO notifications (user_id, type, data, idempotency_key)
		VALUES ($1::uuid, $2, $3::jsonb, $4)
		ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		RETURNING `+notificationColumns,
		n.UserID, string(n.Type), []byte(n.Data), n.IdempotencyKey)
	created, err := scanNotification(row)
	if errors.Is(err, pgx.ErrNoRows) {
		if n.IdempotencyKey == nil {
			return Notification{}, false, fmt.Errorf("notifications: insert returned no row without key")
		}
		existing, ok, lookupErr := notificationByIdempotencyKey(ctx, db, *n.IdempotencyKey)
		if lookupErr != nil {
			return Notification{}, false, lookupErr
		}
		if !ok {
			return Notification{}, false, fmt.Errorf("notifications: conflict but row missing for key %s", *n.IdempotencyKey)
		}
		return existing, false, nil
	}
	if err != nil {
		return Notification{}, false, fmt.Errorf("notifications: inserting: %w", err)
	}
	return created, true, nil
}

func notificationByIdempotencyKey(ctx context.Context, db querier, key string) (Notification, bool, error) {
	n, err := scanNotification(db.QueryRow(ctx, `
		SELECT `+notificationColumns+`
		FROM notifications WHERE idempotency_key = $1`, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return Notification{}, false, nil
	}
	if err != nil {
		return Notification{}, false, fmt.Errorf("notifications: by key: %w", err)
	}
	return n, true, nil
}

func markPushDelivered(ctx context.Context, db querier, ids []string, now time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := db.Exec(ctx, `
		UPDATE notifications
		SET push_delivered = true, updated_at = $2
		WHERE id = ANY($1::uuid[])`, ids, now)
	if err != nil {
		return fmt.Errorf("notifications: marking push delivered: %w", err)
	}
	return nil
}

func getNotificationsByIDs(ctx context.Context, db querier, ids []string) ([]Notification, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := db.Query(ctx, `
		SELECT `+notificationColumns+`
		FROM notifications WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, fmt.Errorf("notifications: by ids: %w", err)
	}
	defer rows.Close()
	var out []Notification
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func deleteUserNotificationsData(ctx context.Context, db querier, userID string) (notifications, settings, devices int64, err error) {
	tag, err := db.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1::uuid`, userID)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("notifications: deleting notifications: %w", err)
	}
	notifications = tag.RowsAffected()

	tag, err = db.Exec(ctx, `DELETE FROM notification_settings WHERE user_id = $1::uuid`, userID)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("notifications: deleting settings: %w", err)
	}
	settings = tag.RowsAffected()

	tag, err = db.Exec(ctx, `DELETE FROM device_tokens WHERE user_id = $1::uuid`, userID)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("notifications: deleting devices: %w", err)
	}
	devices = tag.RowsAffected()
	return notifications, settings, devices, nil
}

func hasAnyNotificationData(ctx context.Context, db querier, userID string) (bool, error) {
	var hasSettings bool
	if err := db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM notification_settings WHERE user_id = $1::uuid)`, userID).Scan(&hasSettings); err != nil {
		return false, err
	}
	if hasSettings {
		return true, nil
	}
	var hasNotifications bool
	if err := db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM notifications WHERE user_id = $1::uuid)`, userID).Scan(&hasNotifications); err != nil {
		return false, err
	}
	return hasNotifications, nil
}

func listNotificationsForExport(ctx context.Context, db querier, userID string) ([]Notification, error) {
	rows, err := db.Query(ctx, `
		SELECT `+notificationColumns+`
		FROM notifications
		WHERE user_id = $1::uuid
		ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("notifications: export list: %w", err)
	}
	defer rows.Close()
	var out []Notification
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
