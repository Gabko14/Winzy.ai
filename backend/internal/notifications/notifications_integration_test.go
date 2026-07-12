//go:build integration

package notifications_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/notifications"
)

func TestListNotifications_Empty(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "n1@example.com", "nuser1")
	code, body := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications",
		headers: bearerFor(t, stack.tokens, user.User.ID),
	})
	if code != 200 {
		t.Fatalf("status = %d body=%v", code, body)
	}
	if body["total"].(float64) != 0 {
		t.Fatalf("total = %v", body["total"])
	}
}

func TestSettings_ReadUnread_DeviceParity(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "n2@example.com", "nuser2")
	headers := bearerFor(t, stack.tokens, user.User.ID)

	code, body := doRequest(t, stack.srv, testRequest{
		method: "PUT", path: "/notifications/settings", headers: headers,
		body: map[string]any{"friendActivity": false, "habitReminders": true},
	})
	if code != 200 {
		t.Fatalf("settings status = %d body=%v", code, body)
	}
	if body["friendActivity"] != false {
		t.Fatalf("friendActivity = %v", body["friendActivity"])
	}

	code, _ = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/notifications/devices", headers: headers,
		body: map[string]any{
			"platform": "web_push",
			"token":    `{"endpoint":"https://example.com","keys":{"p256dh":"x","auth":"y"}}`,
			"deviceId": "browser-1",
		},
	})
	if code != 201 {
		t.Fatalf("register device status = %d", code)
	}

	code, _ = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/notifications/devices", headers: headers,
		body: map[string]any{
			"platform": "expo_push",
			"token":    "ExponentPushToken[stub]",
			"deviceId": "browser-1",
		},
	})
	if code != 201 {
		t.Fatalf("upsert device status = %d", code)
	}

	code, body = doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications/unread-count", headers: headers,
	})
	if code != 200 || body["unreadCount"].(float64) != 0 {
		t.Fatalf("unread = %d %v", code, body)
	}

	code, _ = doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/notifications/devices", headers: headers,
		body: map[string]any{"deviceId": "browser-1"},
	})
	if code != 204 {
		t.Fatalf("unregister status = %d", code)
	}

	code, _ = doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/notifications/devices", headers: headers,
		body: map[string]any{"deviceId": "browser-1"},
	})
	if code != 404 {
		t.Fatalf("unregister missing status = %d", code)
	}
}

func TestVAPIDPublicKey_NotConfigured_404(t *testing.T) {
	stack := newTestStack(t)
	code, body := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications/vapid-public-key",
	})
	if code != 404 {
		t.Fatalf("status = %d body=%v", code, body)
	}
	if body["error"] != "VAPID public key not configured" {
		t.Fatalf("error = %v", body["error"])
	}
}

func TestHabitCompleted_FanOut_FiltersAndIdempotency(t *testing.T) {
	stack := newTestStack(t)
	actor := registerUser(t, stack.authService, "actor@example.com", "actoruser")
	friendOK := registerUser(t, stack.authService, "friendok@example.com", "friendok")
	friendOff := registerUser(t, stack.authService, "friendoff@example.com", "friendoff")
	makeFriends(t, stack, actor.User.ID, friendOK.User.ID)
	makeFriends(t, stack, actor.User.ID, friendOff.User.ID)

	friendActivity := false
	if _, err := stack.notificationsService.UpdateSettings(context.Background(), friendOff.User.ID, notifications.UpdateSettingsRequest{
		FriendActivity: &friendActivity,
	}); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}

	habitID := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	date := time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC)
	evt := events.HabitCompleted{
		UserID: actor.User.ID, HabitID: habitID, Date: date,
		Consistency: 0.9, DisplayName: "Actor", HabitName: "Run",
	}
	if err := events.Emit(context.Background(), stack.registry, evt); err != nil {
		t.Fatalf("emit 1: %v", err)
	}
	if err := events.Emit(context.Background(), stack.registry, evt); err != nil {
		t.Fatalf("emit 2: %v", err)
	}

	code, body := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications",
		headers: bearerFor(t, stack.tokens, friendOK.User.ID),
	})
	if code != 200 {
		t.Fatalf("list friendOK status=%d body=%v", code, body)
	}
	if got := countType(body, "habitcompleted"); got != 1 {
		t.Fatalf("friendOK habitcompleted=%d want 1 (idempotent); body=%v", got, body)
	}

	code, body = doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications",
		headers: bearerFor(t, stack.tokens, friendOff.User.ID),
	})
	if code != 200 || countType(body, "habitcompleted") != 0 {
		t.Fatalf("friendOff should be filtered from habitcompleted, got %d %v", code, body)
	}

	code, body = doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications",
		headers: bearerFor(t, stack.tokens, actor.User.ID),
	})
	if code != 200 || countType(body, "habitcompleted") != 0 {
		t.Fatalf("self should not get habitcompleted, got %d %v", code, body)
	}
}

func countType(body map[string]any, typ string) int {
	items, _ := body["items"].([]any)
	n := 0
	for _, it := range items {
		if m, ok := it.(map[string]any); ok && m["type"] == typ {
			n++
		}
	}
	return n
}

func TestMarkReadAndReadAll(t *testing.T) {
	stack := newTestStack(t)
	actor := registerUser(t, stack.authService, "actor2@example.com", "actor2")
	friend := registerUser(t, stack.authService, "friend2@example.com", "friend2")
	makeFriends(t, stack, actor.User.ID, friend.User.ID)

	if err := events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: actor.User.ID, HabitID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
		Date: time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC), Consistency: 0.5,
	}); err != nil {
		t.Fatalf("emit: %v", err)
	}

	headers := bearerFor(t, stack.tokens, friend.User.ID)
	code, body := doRequest(t, stack.srv, testRequest{method: "GET", path: "/notifications", headers: headers})
	if code != 200 || countType(body, "habitcompleted") != 1 {
		t.Fatalf("list: %d %v", code, body)
	}
	var id string
	for _, it := range body["items"].([]any) {
		m := it.(map[string]any)
		if m["type"] == "habitcompleted" {
			id = m["id"].(string)
			break
		}
	}

	code, beforeBody := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications/unread-count", headers: headers,
	})
	if code != 200 {
		t.Fatalf("unread before: %d %v", code, beforeBody)
	}
	before := int(beforeBody["unreadCount"].(float64))

	code, body = doRequest(t, stack.srv, testRequest{
		method: "PUT", path: "/notifications/" + id + "/read", headers: headers,
	})
	if code != 200 || body["readAt"] == nil {
		t.Fatalf("mark read: %d %v", code, body)
	}

	code, afterBody := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications/unread-count", headers: headers,
	})
	if code != 200 {
		t.Fatalf("unread after read: %d %v", code, afterBody)
	}
	after := int(afterBody["unreadCount"].(float64))
	if after != before-1 {
		t.Fatalf("unread after marking habitcompleted: before=%d after=%d want %d", before, after, before-1)
	}

	code, body = doRequest(t, stack.srv, testRequest{
		method: "PUT", path: "/notifications/read-all", headers: headers,
	})
	if code != 200 {
		t.Fatalf("read-all: %d %v", code, body)
	}
	code, body = doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications/unread-count", headers: headers,
	})
	if code != 200 || body["unreadCount"].(float64) != 0 {
		t.Fatalf("unread after read-all: %d %v", code, body)
	}
}

func TestFriendRequestAndChallengeHandlers(t *testing.T) {
	stack := newTestStack(t)
	a := registerUser(t, stack.authService, "a3@example.com", "auser3")
	b := registerUser(t, stack.authService, "b3@example.com", "buser3")

	if err := events.Emit(context.Background(), stack.registry, events.FriendRequestSent{
		From: a.User.ID, To: b.User.ID,
	}); err != nil {
		t.Fatalf("FriendRequestSent: %v", err)
	}
	code, body := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications",
		headers: bearerFor(t, stack.tokens, b.User.ID),
	})
	if code != 200 || body["total"].(float64) != 1 {
		t.Fatalf("after friend request: %d %v", code, body)
	}
	if body["items"].([]any)[0].(map[string]any)["type"] != "friendrequestsent" {
		t.Fatalf("type = %v", body["items"].([]any)[0].(map[string]any)["type"])
	}

	if err := events.Emit(context.Background(), stack.registry, events.FriendRequestAccepted{
		UserID1: a.User.ID, UserID2: b.User.ID,
	}); err != nil {
		t.Fatalf("FriendRequestAccepted: %v", err)
	}

	code, body = doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications",
		headers: bearerFor(t, stack.tokens, a.User.ID),
	})
	if code != 200 || body["total"].(float64) < 1 {
		t.Fatalf("user A after accept: %d %v", code, body)
	}

	challengeID := "cccccccc-cccc-cccc-cccc-cccccccccccc"
	habitID := "dddddddd-dddd-dddd-dddd-dddddddddddd"
	if err := events.Emit(context.Background(), stack.registry, events.ChallengeCreated{
		ChallengeID: challengeID, From: a.User.ID, To: b.User.ID, HabitID: habitID,
	}); err != nil {
		t.Fatalf("ChallengeCreated: %v", err)
	}
	if err := events.Emit(context.Background(), stack.registry, events.ChallengeCompleted{
		ChallengeID: challengeID, UserID: b.User.ID, Reward: "coffee",
	}); err != nil {
		t.Fatalf("ChallengeCompleted: %v", err)
	}

	code, body = doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications",
		headers: bearerFor(t, stack.tokens, b.User.ID),
	})
	if code != 200 || body["total"].(float64) < 3 {
		t.Fatalf("user B notifications: %d %v", code, body)
	}
}

func TestUserDeleted_CleansNotificationData(t *testing.T) {
	stack := newTestStack(t)
	a := registerUser(t, stack.authService, "del@example.com", "deluser")
	b := registerUser(t, stack.authService, "keep@example.com", "keepuser")
	makeFriends(t, stack, a.User.ID, b.User.ID)

	if err := events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: b.User.ID, HabitID: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
		Date: time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("emit: %v", err)
	}
	if _, err := stack.notificationsService.UpdateSettings(context.Background(), a.User.ID, notifications.UpdateSettingsRequest{}); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	deviceID := "dev-del"
	if err := stack.notificationsService.RegisterDevice(context.Background(), a.User.ID, notifications.RegisterDeviceRequest{
		Platform: "web_push",
		Token:    `{"endpoint":"https://example.com","keys":{"p256dh":"x","auth":"y"}}`,
		DeviceID: &deviceID,
	}); err != nil {
		t.Fatalf("RegisterDevice: %v", err)
	}

	if err := events.Emit(context.Background(), stack.registry, events.UserDeleted{UserID: a.User.ID}); err != nil {
		t.Fatalf("UserDeleted: %v", err)
	}

	code, body := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/notifications",
		headers: bearerFor(t, stack.tokens, a.User.ID),
	})
	if code != 200 || body["total"].(float64) != 0 {
		t.Fatalf("after delete list: %d %v", code, body)
	}
}

func TestExport_NoData_OmitsSection(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "exp@example.com", "expuser")
	sections, warnings := stack.exportReg.Export(context.Background(), user.User.ID)
	for _, s := range sections {
		if s.Service == "notification" {
			t.Fatalf("expected no notification section for empty user, got %+v warnings=%v", s, warnings)
		}
	}
}

func TestExport_WithData(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "exp2@example.com", "expuser2")
	friend := registerUser(t, stack.authService, "exp3@example.com", "expuser3")
	makeFriends(t, stack, user.User.ID, friend.User.ID)
	if err := events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: friend.User.ID, HabitID: "ffffffff-ffff-ffff-ffff-ffffffffffff",
		Date: time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("emit: %v", err)
	}

	sections, _ := stack.exportReg.Export(context.Background(), user.User.ID)
	found := false
	for _, s := range sections {
		if s.Service == "notification" {
			found = true
			raw, _ := json.Marshal(s.Data)
			var data map[string]any
			_ = json.Unmarshal(raw, &data)
			if data["settings"] == nil || data["notifications"] == nil {
				t.Fatalf("export data missing fields: %s", raw)
			}
		}
	}
	if !found {
		t.Fatal("expected notification export section")
	}
}

func TestDeviceValidationErrors(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "dev@example.com", "devuser")
	headers := bearerFor(t, stack.tokens, user.User.ID)

	code, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/notifications/devices", headers: headers, body: "null",
	})
	if code != 400 || body["error"] != "Request body is required" {
		t.Fatalf("null body: %d %v", code, body)
	}

	code, body = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/notifications/devices", headers: headers,
		body: map[string]any{"platform": "bad", "token": "t"},
	})
	if code != 400 {
		t.Fatalf("bad platform: %d %v", code, body)
	}
}
