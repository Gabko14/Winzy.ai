package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/db"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/social"
)

// Service is the notifications module's business logic.
type Service struct {
	pool               *pgxpool.Pool
	registry           *events.Registry
	logger             *slog.Logger
	social             *social.Service
	delivery           *DeliveryService
	vapidPublicKey     string
	now                func() time.Time
	skipVisibilityPoll bool // tests that insert via pool skip the commit-visibility poll
}

// VAPIDConfig holds optional Web Push credentials.
// Cutover mapping (rdc7.10): WebPush__Subject/PublicKey/PrivateKey →
// VAPID_SUBJECT / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
type VAPIDConfig struct {
	Subject    string
	PublicKey  string
	PrivateKey string
}

// NewService wires handlers, export, and optional web-push delivery.
func NewService(
	pool *pgxpool.Pool,
	registry *events.Registry,
	exportReg *export.Registry,
	socialSvc *social.Service,
	vapid VAPIDConfig,
	logger *slog.Logger,
) *Service {
	s := &Service{
		pool:     pool,
		registry: registry,
		logger:   logger,
		social:   socialSvc,
		now:      func() time.Time { return time.Now().UTC() },
	}

	enabled := vapid.PublicKey != "" && vapid.PrivateKey != ""
	subject := vapid.Subject
	if subject == "" {
		subject = "mailto:hello@winzy.ai"
	}
	s.vapidPublicKey = vapid.PublicKey

	var sender PushSender
	if enabled {
		ws, err := newWebPushSender(subject, vapid.PublicKey, vapid.PrivateKey, nil, logger)
		if err != nil {
			logger.Error("failed to configure web push — push disabled", "error", err)
			enabled = false
		} else {
			sender = ws
		}
	}
	if !enabled {
		logger.Warn("VAPID keys not configured — web push delivery disabled (tokens kept)")
	}
	s.delivery = newDeliveryService(pool, sender, enabled, logger)

	events.Register(registry, s.handleHabitCompleted)
	events.Register(registry, s.handleFriendRequestSent)
	events.Register(registry, s.handleFriendRequestAccepted)
	events.Register(registry, s.handleChallengeCreated)
	events.Register(registry, s.handleChallengeCompleted)
	events.Register(registry, s.handleUserDeleted)
	exportReg.Register("notification", s.exportSection)
	return s
}

// SetClock overrides the clock (tests).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// SetPushSender replaces the push sender (tests with fake HTTP push server).
func (s *Service) SetPushSender(sender PushSender) {
	s.delivery.sender = sender
	s.delivery.enabled = sender != nil
}

// SetSkipVisibilityPoll skips the detached-delivery visibility poll (tests).
func (s *Service) SetSkipVisibilityPoll(skip bool) { s.skipVisibilityPoll = skip }

// VAPIDPublicKey returns the configured public key, or empty if unset.
func (s *Service) VAPIDPublicKey() string { return s.vapidPublicKey }

// List returns a page of notifications for userID.
func (s *Service) List(ctx context.Context, userID string, page, pageSize int) (listNotificationsResponse, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 1
	}
	if pageSize > 100 {
		pageSize = 100
	}
	items, total, err := listNotifications(ctx, s.pool, userID, page, pageSize)
	if err != nil {
		return listNotificationsResponse{}, err
	}
	out := make([]notificationResponse, len(items))
	for i, n := range items {
		out[i] = toNotificationResponse(n)
	}
	return listNotificationsResponse{Items: out, Page: page, PageSize: pageSize, Total: total}, nil
}

// MarkRead marks one notification read.
func (s *Service) MarkRead(ctx context.Context, userID, id string) (notificationResponse, error) {
	if !isValidUUID(id) {
		return notificationResponse{}, ErrNotFound
	}
	n, err := markNotificationRead(ctx, s.pool, id, userID, s.now())
	if err != nil {
		return notificationResponse{}, err
	}
	return toNotificationResponse(n), nil
}

// MarkAllRead marks every unread notification for userID.
func (s *Service) MarkAllRead(ctx context.Context, userID string) (int64, error) {
	return markAllRead(ctx, s.pool, userID, s.now())
}

// UnreadCount returns the unread total.
func (s *Service) UnreadCount(ctx context.Context, userID string) (int, error) {
	return unreadCount(ctx, s.pool, userID)
}

// UpdateSettings upserts preference flags.
func (s *Service) UpdateSettings(ctx context.Context, userID string, req UpdateSettingsRequest) (settingsResponse, error) {
	srow, err := upsertSettings(ctx, s.pool, userID, req, s.now())
	if err != nil {
		return settingsResponse{}, err
	}
	return settingsResponse{
		HabitReminders:   srow.HabitReminders,
		FriendActivity:   srow.FriendActivity,
		ChallengeUpdates: srow.ChallengeUpdates,
	}, nil
}

// RegisterDevice upserts a device token by (userId, deviceId).
func (s *Service) RegisterDevice(ctx context.Context, userID string, req RegisterDeviceRequest) error {
	return registerDevice(ctx, s.pool, userID, req, s.now())
}

// UnregisterDevice deletes a device by deviceId.
func (s *Service) UnregisterDevice(ctx context.Context, userID, deviceID string) error {
	ok, err := unregisterDevice(ctx, s.pool, userID, deviceID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func (s *Service) handleHabitCompleted(ctx context.Context, event events.HabitCompleted) error {
	friendIDs, err := s.social.FriendIDs(ctx, event.UserID)
	if err != nil {
		s.logger.WarnContext(ctx, "friends lookup failed — skipping fan-out",
			"user_id", event.UserID, "error", err)
		return nil
	}

	resolved := len(friendIDs)
	seen := make(map[string]struct{}, len(friendIDs))
	var targets []string
	for _, id := range friendIDs {
		if id == event.UserID {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		targets = append(targets, id)
	}

	q := db.QuerierFrom(ctx, s.pool)
	settings, err := settingsMapForUsers(ctx, q, targets)
	if err != nil {
		return err
	}

	var eligible []string
	for _, id := range targets {
		if srow, ok := settings[id]; ok && !srow.FriendActivity {
			continue
		}
		eligible = append(eligible, id)
	}

	dateStr := time.Date(event.Date.Year(), event.Date.Month(), event.Date.Day(), 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	title, body := buildHabitPushText(event)

	var jobs []deliveryJob
	filtered := resolved - len(eligible)
	var sent, failed int

	for _, friendID := range eligible {
		key := fmt.Sprintf("habit_completed:%s:%s:%s:%s", friendID, event.UserID, event.HabitID, dateStr)
		data, _ := json.Marshal(map[string]any{
			"fromUserId":  event.UserID,
			"habitId":     event.HabitID,
			"date":        dateStr,
			"consistency": event.Consistency,
		})
		keyCopy := key
		n, inserted, err := insertNotificationIdempotent(ctx, q, Notification{
			UserID:         friendID,
			Type:           TypeHabitCompleted,
			Data:           data,
			IdempotencyKey: &keyCopy,
		})
		if err != nil {
			failed++
			s.logger.WarnContext(ctx, "failed to insert habit.completed notification",
				"friend_id", friendID, "error", err)
			continue
		}
		if !inserted && n.PushDelivered {
			continue
		}
		jobs = append(jobs, deliveryJob{
			NotificationID: n.ID, UserID: friendID,
			Title: title, Body: body, URL: "/friends",
		})
		sent++
	}

	s.logger.InfoContext(ctx, "habit.completed fan-out summary",
		"actor_id", event.UserID,
		"resolved", resolved,
		"filtered", filtered,
		"sent", sent,
		"failed", failed,
	)

	s.scheduleDelivery(jobs)
	return nil
}

func buildHabitPushText(event events.HabitCompleted) (string, string) {
	friendName := event.DisplayName
	if friendName == "" {
		friendName = "A friend"
	}
	if event.HabitName != "" {
		return friendName + " completed " + event.HabitName + "!",
			friendName + " just completed " + event.HabitName
	}
	return friendName + " completed a habit!",
		friendName + " just completed a habit"
}

func (s *Service) handleFriendRequestSent(ctx context.Context, event events.FriendRequestSent) error {
	q := db.QuerierFrom(ctx, s.pool)
	settings, found, err := getSettings(ctx, q, event.To)
	if err != nil {
		return err
	}
	if found && !settings.FriendActivity {
		s.logger.InfoContext(ctx, "skipping friend.request.sent — FriendActivity disabled",
			"user_id", event.To)
		return nil
	}

	key := fmt.Sprintf("friend_request_sent:%s:%s", event.To, event.From)
	data, _ := json.Marshal(map[string]string{"fromUserId": event.From})
	keyCopy := key
	n, inserted, err := insertNotificationIdempotent(ctx, q, Notification{
		UserID: event.To, Type: TypeFriendRequestSent, Data: data, IdempotencyKey: &keyCopy,
	})
	if err != nil {
		return err
	}
	if !inserted && n.PushDelivered {
		return nil
	}
	s.scheduleDelivery([]deliveryJob{{
		NotificationID: n.ID, UserID: event.To,
		Title: "New friend request", Body: "Someone sent you a friend request", URL: "/friends",
	}})
	return nil
}

func (s *Service) handleFriendRequestAccepted(ctx context.Context, event events.FriendRequestAccepted) error {
	q := db.QuerierFrom(ctx, s.pool)
	type pair struct {
		userID, otherID string
	}
	pairs := []pair{
		{event.UserID1, event.UserID2},
		{event.UserID2, event.UserID1},
	}
	var jobs []deliveryJob
	for _, p := range pairs {
		settings, found, err := getSettings(ctx, q, p.userID)
		if err != nil {
			return err
		}
		if found && !settings.FriendActivity {
			s.logger.InfoContext(ctx, "skipping friend.request.accepted — FriendActivity disabled",
				"user_id", p.userID)
			continue
		}
		key := fmt.Sprintf("friend_request_accepted:%s:%s", p.userID, p.otherID)
		data, _ := json.Marshal(map[string]string{"otherUserId": p.otherID})
		keyCopy := key
		n, inserted, err := insertNotificationIdempotent(ctx, q, Notification{
			UserID: p.userID, Type: TypeFriendRequestAccepted, Data: data, IdempotencyKey: &keyCopy,
		})
		if err != nil {
			return err
		}
		if !inserted && n.PushDelivered {
			continue
		}
		jobs = append(jobs, deliveryJob{
			NotificationID: n.ID, UserID: p.userID,
			Title: "Friend request accepted", Body: "Your friend request was accepted!", URL: "/friends",
		})
	}
	s.scheduleDelivery(jobs)
	return nil
}

func (s *Service) handleChallengeCreated(ctx context.Context, event events.ChallengeCreated) error {
	q := db.QuerierFrom(ctx, s.pool)
	settings, found, err := getSettings(ctx, q, event.To)
	if err != nil {
		return err
	}
	if found && !settings.ChallengeUpdates {
		s.logger.InfoContext(ctx, "skipping challenge.created — ChallengeUpdates disabled",
			"user_id", event.To)
		return nil
	}

	key := fmt.Sprintf("challenge_created:%s:%s", event.To, event.ChallengeID)
	data, _ := json.Marshal(map[string]string{
		"challengeId": event.ChallengeID,
		"fromUserId":  event.From,
		"habitId":     event.HabitID,
	})
	keyCopy := key
	n, inserted, err := insertNotificationIdempotent(ctx, q, Notification{
		UserID: event.To, Type: TypeChallengeCreated, Data: data, IdempotencyKey: &keyCopy,
	})
	if err != nil {
		return err
	}
	if !inserted && n.PushDelivered {
		return nil
	}
	s.scheduleDelivery([]deliveryJob{{
		NotificationID: n.ID, UserID: event.To,
		Title: "New challenge!", Body: "Someone challenged you — check it out!", URL: "/challenges",
	}})
	return nil
}

func (s *Service) handleChallengeCompleted(ctx context.Context, event events.ChallengeCompleted) error {
	q := db.QuerierFrom(ctx, s.pool)
	settings, found, err := getSettings(ctx, q, event.UserID)
	if err != nil {
		return err
	}
	if found && !settings.ChallengeUpdates {
		s.logger.InfoContext(ctx, "skipping challenge.completed — ChallengeUpdates disabled",
			"user_id", event.UserID)
		return nil
	}

	key := fmt.Sprintf("challenge_completed:%s:%s", event.UserID, event.ChallengeID)
	data, _ := json.Marshal(map[string]string{
		"challengeId": event.ChallengeID,
		"reward":      event.Reward,
	})
	keyCopy := key
	n, inserted, err := insertNotificationIdempotent(ctx, q, Notification{
		UserID: event.UserID, Type: TypeChallengeCompleted, Data: data, IdempotencyKey: &keyCopy,
	})
	if err != nil {
		return err
	}
	if !inserted && n.PushDelivered {
		return nil
	}
	s.scheduleDelivery([]deliveryJob{{
		NotificationID: n.ID, UserID: event.UserID,
		Title: "Challenge completed!",
		Body:  "You completed a challenge — time for: " + event.Reward,
		URL:   "/challenges",
	}})
	return nil
}

func (s *Service) handleUserDeleted(ctx context.Context, event events.UserDeleted) error {
	q := db.QuerierFrom(ctx, s.pool)
	n, settings, devices, err := deleteUserNotificationsData(ctx, q, event.UserID)
	if err != nil {
		return fmt.Errorf("notifications: cascading user.deleted: %w", err)
	}
	s.logger.InfoContext(ctx, "deleted notification data for user",
		"user_id", event.UserID,
		"notifications", n,
		"settings", settings,
		"device_tokens", devices,
	)
	return nil
}

// validateRegisterDevice mirrors Program.cs device registration checks.
func validateRegisterDevice(req RegisterDeviceRequest) string {
	if strings.TrimSpace(req.Platform) == "" || strings.TrimSpace(req.Token) == "" {
		return "Platform and token are required"
	}
	if req.Platform != PlatformWebPush && req.Platform != PlatformExpoPush {
		return "Platform must be 'web_push' or 'expo_push'"
	}
	return ""
}
