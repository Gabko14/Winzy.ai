package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	webpush "github.com/marknefedov/go-webpush/v2"
)

// maxConcurrentPush matches C# HabitCompletedSubscriber.MaxConcurrentPushDeliveries.
const maxConcurrentPush = 10

// pushTTLSeconds is the C# web-push library default (4 weeks). The C# client
// never set TTL explicitly; WebPushClient used 2419200. A 1h TTL would drop
// pushes for users offline longer than an hour.
const pushTTLSeconds = 2419200

// PushSender is the testable surface over web-push delivery.
type PushSender interface {
	Send(ctx context.Context, subscriptionJSON []byte, payload []byte) pushOutcome
}

type pushOutcome struct {
	StatusCode int
	Expired    bool // 404/410 → delete token
	Temporary  bool // 429/5xx → keep
	Err        error
}

type webPushSender struct {
	client  *webpush.Client
	subject string
	keys    *webpush.VAPIDKeys
	logger  *slog.Logger
}

func newWebPushSender(subject, publicKey, privateKey string, httpClient *http.Client, logger *slog.Logger) (*webPushSender, error) {
	keyJSON, err := json.Marshal(map[string]string{
		"publicKey":  publicKey,
		"privateKey": privateKey,
	})
	if err != nil {
		return nil, err
	}
	var keys webpush.VAPIDKeys
	if err := json.Unmarshal(keyJSON, &keys); err != nil {
		return nil, fmt.Errorf("notifications: parsing VAPID keys: %w", err)
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &webPushSender{
		client: webpush.NewClient(webpush.Config{
			HTTPClient:         httpClient,
			MaxConcurrentSends: maxConcurrentPush,
		}),
		subject: subject,
		keys:    &keys,
		logger:  logger,
	}, nil
}

func (s *webPushSender) Send(ctx context.Context, subscriptionJSON []byte, payload []byte) pushOutcome {
	var sub webpush.Subscription
	if err := json.Unmarshal(subscriptionJSON, &sub); err != nil {
		// Invalid JSON → delete token (C# PushDeliveryService returns false).
		return pushOutcome{Err: err}
	}
	if sub.Endpoint == "" || sub.Keys.P256dh == nil || sub.Keys.Auth == [16]byte{} {
		// C# PushDeliveryService.cs:79-83 returns false (→ delete) when endpoint
		// or keys.p256dh or keys.auth is missing.
		return pushOutcome{Err: fmt.Errorf("notifications: invalid web push subscription")}
	}
	result, err := s.client.Send(ctx, payload, &sub, webpush.SendOptions{
		Subject:   s.subject,
		VAPIDKeys: s.keys,
		TTL:       pushTTLSeconds,
	})
	if err != nil {
		var pushErr *webpush.PushServiceError
		if errors.As(err, &pushErr) {
			return pushOutcome{
				StatusCode: pushErr.StatusCode,
				Expired:    pushErr.SubscriptionExpired,
				Temporary:  pushErr.Temporary,
				Err:        err,
			}
		}
		return pushOutcome{Err: err, Temporary: true}
	}
	if result != nil && result.Response != nil {
		_ = result.Response.Body.Close()
		return pushOutcome{StatusCode: result.StatusCode}
	}
	return pushOutcome{StatusCode: http.StatusCreated}
}

// DeliveryService delivers push notifications best-effort to a user's devices.
type DeliveryService struct {
	pool    *pgxpool.Pool
	sender  PushSender
	enabled bool
	logger  *slog.Logger
}

func newDeliveryService(pool *pgxpool.Pool, sender PushSender, enabled bool, logger *slog.Logger) *DeliveryService {
	return &DeliveryService{pool: pool, sender: sender, enabled: enabled, logger: logger}
}

type pushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Icon  string `json:"icon"`
	Badge string `json:"badge"`
}

func (d *DeliveryService) Deliver(ctx context.Context, userID, title, body, url, notificationID string) {
	if !d.enabled || d.sender == nil {
		// Startup already logged once when VAPID was missing (NewService).
		return
	}
	if url == "" {
		url = "/"
	}
	tokens, err := listDeviceTokens(ctx, d.pool, userID)
	if err != nil {
		d.logger.WarnContext(ctx, "failed to load device tokens", "user_id", userID, "error", err)
		return
	}
	if len(tokens) == 0 {
		d.logger.DebugContext(ctx, "no device tokens, skipping push", "user_id", userID)
		return
	}

	payload, err := json.Marshal(pushPayload{
		Title: title,
		Body:  body,
		URL:   url,
		Icon:  "/assets/icon.png",
		Badge: "/assets/favicon.png",
	})
	if err != nil {
		d.logger.ErrorContext(ctx, "failed to marshal push payload", "error", err)
		return
	}

	for _, token := range tokens {
		d.deliverOne(ctx, token, payload, notificationID)
	}
}

func (d *DeliveryService) deliverOne(ctx context.Context, token DeviceToken, payload []byte, notificationID string) {
	start := time.Now()
	deviceID := ""
	if token.DeviceID != nil {
		deviceID = *token.DeviceID
	}

	switch token.Platform {
	case PlatformExpoPush:
		d.logger.InfoContext(ctx, "expo push delivery not yet implemented — skipping",
			"token_id", token.ID, "device_id", deviceID)
		return
	case PlatformWebPush:
		outcome := d.sender.Send(ctx, []byte(token.Token), payload)
		duration := time.Since(start)
		decision := "kept"

		if outcome.Expired || (outcome.Err != nil && !outcome.Temporary) {
			// SubscriptionExpired (404/410) or permanently invalid subscription → delete.
			decision = "deleted"
			if err := deleteDeviceToken(ctx, d.pool, token.ID); err != nil {
				d.logger.WarnContext(ctx, "failed to delete device token",
					"token_id", token.ID, "error", err)
			}
		}

		status := outcome.StatusCode
		if status == 0 && outcome.Err != nil {
			status = -1
		}
		d.logger.InfoContext(ctx, "push token outcome",
			"notification_id", notificationID,
			"device_id", deviceID,
			"token_id", token.ID,
			"status", status,
			"decision", decision,
			"duration_ms", duration.Milliseconds(),
		)
		return
	default:
		d.logger.WarnContext(ctx, "unknown device platform",
			"platform", token.Platform, "token_id", token.ID)
		return
	}
}

// scheduleDelivery runs push AFTER the caller's transaction commits.
//
// TX STRUCTURE (winzy.ai-rdc7.6 EXECUTION STEPS §3):
//  1. Event handlers insert notification rows via db.QuerierFrom (joining the
//     caller's tx when FriendRequest*/Challenge* emit inside a tx; HabitCompleted
//     arrives post-commit with no tx).
//  2. Push MUST NOT run on the caller's stack. After insert we hand IDs to a
//     detached goroutine (context.Background + ~30s timeout) that:
//     (a) polls the POOL until those rows are visible (committed) — a few
//     retries over ~2s; if the caller's tx rolled back the rows never appear
//     and push is silently dropped for those IDs; already-committed retry IDs
//     are still delivered;
//     (b) loads device tokens;
//     (c) sends with ≤10 concurrent goroutines;
//     (d) sets push_delivered=true after sends complete for that notification.
//
// Tests that insert directly via the pool may set skipVisibilityPoll to skip (a).
type deliveryJob struct {
	NotificationID string
	UserID         string
	Title          string
	Body           string
	URL            string
}

func (s *Service) scheduleDelivery(jobs []deliveryJob) {
	if len(jobs) == 0 {
		return
	}
	go s.runDetachedDelivery(jobs)
}

func (s *Service) runDetachedDelivery(jobs []deliveryJob) {
	defer func() {
		if rec := recover(); rec != nil {
			s.logger.Error("push delivery goroutine panicked", "recover", rec)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if !s.skipVisibilityPoll {
		jobs = s.filterVisibleJobs(ctx, jobs)
		if len(jobs) == 0 {
			s.logger.Debug("notification rows never became visible — push dropped (tx rolled back?)")
			return
		}
	}

	sem := make(chan struct{}, maxConcurrentPush)
	var wg sync.WaitGroup
	var deliveredIDs sync.Map

	for _, job := range jobs {
		job := job
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			s.delivery.Deliver(ctx, job.UserID, job.Title, job.Body, job.URL, job.NotificationID)
			deliveredIDs.Store(job.NotificationID, true)
		}()
	}
	wg.Wait()

	var okIDs []string
	deliveredIDs.Range(func(key, _ any) bool {
		okIDs = append(okIDs, key.(string))
		return true
	})
	if err := markPushDelivered(ctx, s.pool, okIDs, s.now()); err != nil {
		s.logger.Warn("failed to save PushDelivered flags — push may be retried on redelivery",
			"error", err, "count", len(okIDs))
	}
}

// filterVisibleJobs waits briefly for notification rows to commit, then returns
// the subset whose IDs are visible on the pool. Partial visibility matters when
// a job list mixes already-committed retry rows with inserts from a tx that
// later rolls back — dropping the whole batch would skip legitimate retries.
func (s *Service) filterVisibleJobs(ctx context.Context, jobs []deliveryJob) []deliveryJob {
	ids := make([]string, len(jobs))
	for i, j := range jobs {
		ids[i] = j.NotificationID
	}

	deadline := time.Now().Add(2 * time.Second)
	var found []Notification
	for attempt := 0; attempt < 8; attempt++ {
		var err error
		found, err = getNotificationsByIDs(ctx, s.pool, ids)
		if err == nil && len(found) == len(ids) {
			return jobs
		}
		if time.Now().After(deadline) {
			break
		}
		select {
		case <-ctx.Done():
			return filterJobsByFound(jobs, found)
		case <-time.After(250 * time.Millisecond):
		}
	}
	found, _ = getNotificationsByIDs(ctx, s.pool, ids)
	return filterJobsByFound(jobs, found)
}

func filterJobsByFound(jobs []deliveryJob, found []Notification) []deliveryJob {
	if len(found) == 0 {
		return nil
	}
	visible := make(map[string]struct{}, len(found))
	for _, n := range found {
		visible[n.ID] = struct{}{}
	}
	out := make([]deliveryJob, 0, len(found))
	for _, j := range jobs {
		if _, ok := visible[j.NotificationID]; ok {
			out = append(out, j)
		}
	}
	return out
}
