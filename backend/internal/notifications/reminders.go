package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	// Embedded tzdata so IANA lookups work in distroless images.
	_ "time/tzdata"

	"github.com/jackc/pgx/v5/pgxpool"
)

const reminderCatchUpWindow = 15 * time.Minute

// DueChecker is the consumer-side interface for the reminder usefulness
// check (has ≥1 habit due today that is not yet completed). Defined here so
// notifications can be built and tested without importing habits; the real
// habits.Service method is wired from main.go after GO-HABITS.
type DueChecker interface {
	HasUncompletedDueHabits(ctx context.Context, userID string, localDate time.Time) (bool, error)
}

// instanceGuard gates the reminder ticker. Deployed as a single Railway
// instance today — alwaysAcquire is enough — but keep this interface so a
// future multi-instance world can swap in a Postgres advisory-lock guard
// without rewriting the ticker loop.
type instanceGuard interface {
	TryAcquire(ctx context.Context) (bool, error)
	Release(ctx context.Context) error
}

type alwaysAcquire struct{}

func (alwaysAcquire) TryAcquire(context.Context) (bool, error) { return true, nil }
func (alwaysAcquire) Release(context.Context) error            { return nil }

// ReminderScheduler ticks every minute and delivers at most one habit
// reminder per user per local calendar day.
//
// Wall-clock matching algorithm (DST-aware):
//
//  1. Load candidates with habit_reminders=true AND reminder_timezone set.
//  2. Group by distinct IANA timezone; LoadLocation once per group.
//  3. Convert UTC "now" into that location's local wall clock.
//  4. A user matches when local time is in [reminder_time, reminder_time + 15m)
//     (wrapping past midnight). Exact == would miss spring-forward gaps where
//     the chosen local minute never exists; the 15-minute catch-up window
//     recovers those. Fall-back (repeated hour) can fire the match twice —
//     idempotency_key "reminder:{userID}:{localDate}" collapses them to one
//     notification row via the unique index.
//
// Stored reminder_timezone is used ONLY here — never for completion/stats.
type ReminderScheduler struct {
	pool    *pgxpool.Pool
	logger  *slog.Logger
	now     func() time.Time
	due     DueChecker
	guard   instanceGuard
	deliver func(jobs []deliveryJob)
	insert  func(ctx context.Context, userID, localDate string) (Notification, bool, error)
}

func newReminderScheduler(pool *pgxpool.Pool, logger *slog.Logger, now func() time.Time, deliver func([]deliveryJob)) *ReminderScheduler {
	return &ReminderScheduler{
		pool:    pool,
		logger:  logger,
		now:     now,
		guard:   alwaysAcquire{},
		deliver: deliver,
	}
}

func (r *ReminderScheduler) SetDueChecker(due DueChecker) { r.due = due }

func (r *ReminderScheduler) SetClock(now func() time.Time) { r.now = now }

// DisablePushForTests makes TickOnce skip the detached push goroutine so
// tests can freely SetClock without racing markPushDelivered's s.now read.
func (r *ReminderScheduler) DisablePushForTests() {
	r.deliver = func([]deliveryJob) {}
}

// Run ticks until ctx is cancelled. Acquires the instance guard once at
// start; if another instance held it, this loop exits immediately.
func (r *ReminderScheduler) Run(ctx context.Context) {
	ok, err := r.guard.TryAcquire(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "reminder scheduler guard acquire failed", "error", err)
		return
	}
	if !ok {
		r.logger.InfoContext(ctx, "reminder scheduler skipped — another instance holds the guard")
		return
	}
	defer func() { _ = r.guard.Release(context.Background()) }()

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	r.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			r.logger.InfoContext(ctx, "reminder scheduler stopped")
			return
		case <-ticker.C:
			r.tick(ctx)
		}
	}
}

// TickOnce runs a single reminder pass (tests).
func (r *ReminderScheduler) TickOnce(ctx context.Context) { r.tick(ctx) }

func (r *ReminderScheduler) tick(ctx context.Context) {
	if r.due == nil {
		r.logger.DebugContext(ctx, "reminder tick skipped — DueChecker not wired")
		return
	}

	candidates, err := listReminderCandidates(ctx, r.pool)
	if err != nil {
		r.logger.ErrorContext(ctx, "reminder tick: listing candidates", "error", err)
		return
	}
	if len(candidates) == 0 {
		return
	}

	now := r.now()
	byTZ := make(map[string][]reminderCandidate)
	for _, c := range candidates {
		byTZ[c.ReminderTimezone] = append(byTZ[c.ReminderTimezone], c)
	}

	var jobs []deliveryJob
	for tzName, group := range byTZ {
		loc, err := time.LoadLocation(tzName)
		if err != nil {
			r.logger.WarnContext(ctx, "reminder tick: invalid stored timezone",
				"timezone", tzName, "error", err)
			continue
		}
		localNow := now.In(loc)
		localDate := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, time.UTC)
		localDateStr := localDate.Format("2006-01-02")

		for _, c := range group {
			if !inReminderWindow(localNow, c.ReminderTime) {
				continue
			}
			useful, err := r.due.HasUncompletedDueHabits(ctx, c.UserID, localDate)
			if err != nil {
				r.logger.WarnContext(ctx, "reminder tick: due check failed",
					"user_id", c.UserID, "error", err)
				continue
			}
			if !useful {
				continue
			}

			n, inserted, err := r.insertReminder(ctx, c.UserID, localDateStr)
			if err != nil {
				r.logger.WarnContext(ctx, "reminder tick: insert failed",
					"user_id", c.UserID, "error", err)
				continue
			}
			if !inserted && n.PushDelivered {
				continue
			}
			title, body := reminderPushText(c.UserID, localDateStr)
			jobs = append(jobs, deliveryJob{
				NotificationID: n.ID, UserID: c.UserID,
				Title: title, Body: body, URL: "/",
			})
		}
	}
	if len(jobs) > 0 {
		r.deliver(jobs)
	}
}

func (r *ReminderScheduler) insertReminder(ctx context.Context, userID, localDate string) (Notification, bool, error) {
	if r.insert != nil {
		return r.insert(ctx, userID, localDate)
	}
	key := fmt.Sprintf("reminder:%s:%s", userID, localDate)
	data, _ := json.Marshal(map[string]string{"localDate": localDate})
	keyCopy := key
	return insertNotificationIdempotent(ctx, r.pool, Notification{
		UserID:         userID,
		Type:           TypeHabitReminder,
		Data:           data,
		IdempotencyKey: &keyCopy,
	})
}

// inReminderWindow reports whether localNow falls in
// [reminderTime, reminderTime + 15m) on the local clock, wrapping midnight.
func inReminderWindow(localNow, reminderTime time.Time) bool {
	nowMin := localNow.Hour()*60 + localNow.Minute()
	remMin := reminderTime.Hour()*60 + reminderTime.Minute()
	elapsed := nowMin - remMin
	if elapsed < 0 {
		elapsed += 24 * 60
	}
	return elapsed < int(reminderCatchUpWindow/time.Minute)
}

func reminderPushText(userID, localDate string) (string, string) {
	// Slight variation so repeats don't feel robotic; stable per user+day.
	h := 0
	for _, c := range userID + localDate {
		h = 31*h + int(c)
	}
	if h%2 == 0 {
		return "Ready to log today?", "A gentle nudge — your habits are waiting."
	}
	return "Your flame's waiting 🔥", "Ready to keep the streak of consistency going?"
}

func parseReminderTime(raw string) (time.Time, error) {
	trimmed := strings.TrimSpace(raw)
	t, err := time.Parse("15:04", trimmed)
	if err != nil || t.Format("15:04") != trimmed {
		return time.Time{}, fmt.Errorf("reminderTime must be HH:MM")
	}
	return time.Date(0, 1, 1, t.Hour(), t.Minute(), 0, 0, time.UTC), nil
}

func validateReminderTimezone(tz string) error {
	trimmed := strings.TrimSpace(tz)
	if trimmed == "" {
		return fmt.Errorf("reminderTimezone is required when set")
	}
	if _, err := time.LoadLocation(trimmed); err != nil {
		return fmt.Errorf("reminderTimezone must be a valid IANA timezone")
	}
	return nil
}

func validateSettingsUpdate(req UpdateSettingsRequest) error {
	if req.ReminderTime != nil {
		if _, err := parseReminderTime(*req.ReminderTime); err != nil {
			return err
		}
	}
	if req.ReminderTimezone.set && req.ReminderTimezone.value != nil {
		if err := validateReminderTimezone(*req.ReminderTimezone.value); err != nil {
			return err
		}
	}
	return nil
}
