//go:build integration

package notifications_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/notifications"
)

type fakeDueChecker struct {
	useful map[string]bool
}

func (f *fakeDueChecker) HasUncompletedDueHabits(_ context.Context, userID string, _ time.Time) (bool, error) {
	if f.useful == nil {
		return true, nil
	}
	return f.useful[userID], nil
}

func TestSettings_HappyPath_ReminderRoundTrip(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	reg := registerUser(t, stack.authService, "remind-settings@example.com", "remindsettings")
	a := bearerFor(t, stack.tokens, reg.User.ID)

	putCode, putBody := doRequest(t, stack.srv, testRequest{
		method: "PUT", path: "/notifications/settings", headers: a,
		body: map[string]any{
			"habitReminders":   true,
			"reminderTime":     "08:30",
			"reminderTimezone": "Europe/Vienna",
		},
	})
	if putCode != http.StatusOK {
		t.Fatalf("PUT settings status = %d body=%v", putCode, putBody)
	}
	if putBody["reminderTime"] != "08:30" {
		t.Errorf("PUT reminderTime = %v, want 08:30", putBody["reminderTime"])
	}
	if putBody["reminderTimezone"] != "Europe/Vienna" {
		t.Errorf("PUT reminderTimezone = %v, want Europe/Vienna", putBody["reminderTimezone"])
	}

	getCode, getBody := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications/settings", headers: a,
	})
	if getCode != http.StatusOK {
		t.Fatalf("GET settings status = %d body=%v", getCode, getBody)
	}
	if getBody["reminderTime"] != "08:30" || getBody["reminderTimezone"] != "Europe/Vienna" {
		t.Errorf("GET settings = %+v, want 08:30 / Europe/Vienna", getBody)
	}
}

func TestSettings_ErrorCase_InvalidTimeAndTimezone(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	reg := registerUser(t, stack.authService, "remind-bad@example.com", "remindbad")
	a := bearerFor(t, stack.tokens, reg.User.ID)

	badTime, body := doRequest(t, stack.srv, testRequest{
		method: "PUT", path: "/notifications/settings", headers: a,
		body: map[string]any{"reminderTime": "25:00"},
	})
	if badTime != http.StatusBadRequest {
		t.Fatalf("bad time status = %d, want 400 body=%v", badTime, body)
	}

	badTZ, body := doRequest(t, stack.srv, testRequest{
		method: "PUT", path: "/notifications/settings", headers: a,
		body: map[string]any{"reminderTimezone": "Not/AZone"},
	})
	if badTZ != http.StatusBadRequest {
		t.Fatalf("bad tz status = %d, want 400 body=%v", badTZ, body)
	}
}

func TestReminderTick_HappyPath_SendsOnce(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	reg := registerUser(t, stack.authService, "remind-happy@example.com", "remindhappy")
	userID := reg.User.ID

	_, err := stack.notificationsService.UpdateSettings(context.Background(), userID, notifications.UpdateSettingsRequest{
		ReminderTime:     strPtr("19:00"),
		ReminderTimezone: notifications.ReminderTimezoneValue("UTC"),
	})
	if err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}

	due := &fakeDueChecker{useful: map[string]bool{userID: true}}
	stack.notificationsService.SetDueChecker(due)
	stack.notificationsService.ReminderScheduler().DisablePushForTests()
	stack.notificationsService.SetClock(func() time.Time {
		return time.Date(2026, 7, 17, 19, 5, 0, 0, time.UTC)
	})

	stack.notificationsService.ReminderScheduler().TickOnce(context.Background())

	list, err := stack.notificationsService.List(context.Background(), userID, 1, 20)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if list.Total != 1 {
		t.Fatalf("notifications = %d, want 1", list.Total)
	}
	if list.Items[0].Type != "habitreminder" {
		t.Errorf("type = %q, want habitreminder", list.Items[0].Type)
	}

	stack.notificationsService.ReminderScheduler().TickOnce(context.Background())
	list2, err := stack.notificationsService.List(context.Background(), userID, 1, 20)
	if err != nil {
		t.Fatalf("List after double tick: %v", err)
	}
	if list2.Total != 1 {
		t.Fatalf("after double tick total = %d, want 1", list2.Total)
	}
}

func TestReminderTick_EdgeCase_SkipsWhenNotUsefulOrDisabled(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)

	complete := registerUser(t, stack.authService, "remind-done@example.com", "reminddone")
	noDue := registerUser(t, stack.authService, "remind-nodue@example.com", "remindnodue")
	noTZ := registerUser(t, stack.authService, "remind-notz@example.com", "remindnotz")
	toggledOff := registerUser(t, stack.authService, "remind-off@example.com", "remindoff")

	on := true
	off := false
	for _, u := range []string{complete.User.ID, noDue.User.ID} {
		if _, err := stack.notificationsService.UpdateSettings(context.Background(), u, notifications.UpdateSettingsRequest{
			HabitReminders:   &on,
			ReminderTime:     strPtr("19:00"),
			ReminderTimezone: notifications.ReminderTimezoneValue("UTC"),
		}); err != nil {
			t.Fatalf("UpdateSettings(%s): %v", u, err)
		}
	}
	if _, err := stack.notificationsService.UpdateSettings(context.Background(), noTZ.User.ID, notifications.UpdateSettingsRequest{
		HabitReminders: &on,
	}); err != nil {
		t.Fatalf("UpdateSettings noTZ: %v", err)
	}
	if _, err := stack.notificationsService.UpdateSettings(context.Background(), toggledOff.User.ID, notifications.UpdateSettingsRequest{
		HabitReminders:   &off,
		ReminderTime:     strPtr("19:00"),
		ReminderTimezone: notifications.ReminderTimezoneValue("UTC"),
	}); err != nil {
		t.Fatalf("UpdateSettings off: %v", err)
	}

	due := &fakeDueChecker{useful: map[string]bool{
		complete.User.ID:   false,
		noDue.User.ID:      false,
		toggledOff.User.ID: true,
	}}
	stack.notificationsService.SetDueChecker(due)
	stack.notificationsService.ReminderScheduler().DisablePushForTests()
	stack.notificationsService.SetClock(func() time.Time {
		return time.Date(2026, 7, 17, 19, 0, 0, 0, time.UTC)
	})
	stack.notificationsService.ReminderScheduler().TickOnce(context.Background())

	for _, u := range []string{complete.User.ID, noDue.User.ID, noTZ.User.ID, toggledOff.User.ID} {
		list, err := stack.notificationsService.List(context.Background(), u, 1, 20)
		if err != nil {
			t.Fatalf("List(%s): %v", u, err)
		}
		if list.Total != 0 {
			t.Errorf("user %s got %d notifications, want 0", u, list.Total)
		}
	}
}

func TestReminderTick_EdgeCase_DSTFallBackStillOneSend(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	reg := registerUser(t, stack.authService, "remind-dst@example.com", "reminddst")
	userID := reg.User.ID

	_, err := stack.notificationsService.UpdateSettings(context.Background(), userID, notifications.UpdateSettingsRequest{
		ReminderTime:     strPtr("01:30"),
		ReminderTimezone: notifications.ReminderTimezoneValue("America/New_York"),
	})
	if err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}

	due := &fakeDueChecker{useful: map[string]bool{userID: true}}
	stack.notificationsService.SetDueChecker(due)
	stack.notificationsService.ReminderScheduler().DisablePushForTests()

	first := time.Date(2025, 11, 2, 5, 30, 0, 0, time.UTC)
	second := time.Date(2025, 11, 2, 6, 30, 0, 0, time.UTC)

	stack.notificationsService.SetClock(func() time.Time { return first })
	stack.notificationsService.ReminderScheduler().TickOnce(context.Background())
	stack.notificationsService.SetClock(func() time.Time { return second })
	stack.notificationsService.ReminderScheduler().TickOnce(context.Background())

	list, err := stack.notificationsService.List(context.Background(), userID, 1, 20)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if list.Total != 1 {
		raw, _ := json.Marshal(list.Items)
		t.Fatalf("DST fall-back total = %d, want 1; items=%s", list.Total, raw)
	}
}

func strPtr(s string) *string { return &s }
