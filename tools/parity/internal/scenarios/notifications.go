package scenarios

import (
	"fmt"
	"time"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// notificationsLifecycle covers list/read/read-all/unread-count, settings,
// device registration (incl. the preserved expo_push stub) + deletion,
// vapid-public-key, and idempotent fan-out: a friend-activity notification
// for a habit completion must not duplicate when the same date's
// completion is merely updated (not re-created).
var notificationsLifecycle = runner.Scenario{
	Name: "notifications-lifecycle",
	Run: func(ctx *runner.Context) error {
		actor, err := registerUser(ctx, ctx.Native, "register-actor", "notifyactor")
		if err != nil {
			return err
		}
		observer, err := registerUser(ctx, ctx.Native, "register-observer", "notifyobserver")
		if err != nil {
			return err
		}
		if err := becomeFriends(ctx, actor, observer, "establish-friendship"); err != nil {
			return err
		}

		// Both friend.request.sent (notify recipient) and
		// friend.request.accepted (notify both) fan out via async NATS
		// consumers — wait for both to land before taking a recorded
		// snapshot, or the golden would capture whichever partial state
		// happened to be visible at read time.
		waitUntil(ctx.Native, "/notifications", observer.AccessToken, 5*time.Second, func(m map[string]any) bool {
			items, _ := m["items"].([]any)
			seen := map[string]bool{}
			for _, it := range items {
				seen[str(asMap(it), "type")] = true
			}
			return seen["friendrequestsent"] && seen["friendrequestaccepted"]
		})

		listRes, err := ctx.Call(ctx.Native, "observer-list-notifications-after-accept", httpclient.Request{
			Method: "GET",
			Path:   "/notifications",
			Bearer: observer.AccessToken,
			Query:  q("page", "1", "pageSize", "20"),
		}, 200)
		if err != nil {
			return err
		}
		list := asMap(listRes.JSON)
		items, _ := list["items"].([]any)
		if len(items) == 0 {
			ctx.Fail("observer-list-notifications-after-accept", httpclient.Request{}, listRes,
				"expected at least one notification (friendrequestaccepted) for the observer")
		} else {
			firstID := str(asMap(items[0]), "id")
			_, err = ctx.Call(ctx.Native, "mark-one-read", httpclient.Request{
				Method: "PUT",
				Path:   fmt.Sprintf("/notifications/%s/read", firstID),
				Bearer: observer.AccessToken,
			}, 200)
			if err != nil {
				return err
			}
		}

		h, err := createHabit(ctx, ctx.Native, "actor-creates-habit", "notifyactor", "run", actor.AccessToken, map[string]any{
			"name":      "Run",
			"frequency": "daily",
		})
		if err != nil {
			return err
		}
		today := todayIn("UTC")
		_, err = ctx.Call(ctx.Native, "actor-completes-habit", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/habits/%s/complete", h.ID),
			Bearer: actor.AccessToken,
			Body:   map[string]any{"date": today, "timezone": "UTC"},
		}, 201)
		if err != nil {
			return err
		}

		// habit.completed fan-out to friends is processed by an async NATS
		// consumer, not synchronously within the POST /complete request —
		// wait for the friend-activity notification to actually land before
		// taking our "before" baseline.
		waitUntil(ctx.Native, "/notifications", observer.AccessToken, 5*time.Second, func(m map[string]any) bool {
			items, _ := m["items"].([]any)
			for _, it := range items {
				if str(asMap(it), "type") == "habitcompleted" {
					return true
				}
			}
			return false
		})

		countBeforeRes, err := ctx.Call(ctx.Native, "observer-unread-count-after-completion", httpclient.Request{
			Method: "GET",
			Path:   "/notifications/unread-count",
			Bearer: observer.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		countBefore := flt(asMap(countBeforeRes.JSON), "unreadCount")

		// Update (not re-create) the same date's completion kind — the
		// fan-out is keyed off the event, and this must not spawn a second
		// "habitcompleted" notification for the same actor/habit/date.
		_, err = ctx.Call(ctx.Native, "actor-updates-same-date-kind", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/habits/%s/completions/%s", h.ID, today),
			Bearer: actor.AccessToken,
			Body:   map[string]any{"completionKind": "full"},
		}, 200)
		if err != nil {
			return err
		}

		// No positive condition to poll for (checking a second notification
		// did NOT land) — give any async processing a fixed window to
		// (mis)fire before reading the authoritative state.
		settle(800 * time.Millisecond)

		countAfterRes, err := ctx.Call(ctx.Native, "observer-unread-count-after-same-date-update", httpclient.Request{
			Method: "GET",
			Path:   "/notifications/unread-count",
			Bearer: observer.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		countAfter := flt(asMap(countAfterRes.JSON), "unreadCount")
		if countAfter != countBefore {
			ctx.Fail("observer-unread-count-after-same-date-update", httpclient.Request{}, countAfterRes,
				fmt.Sprintf("expected unread count to stay at %.0f (idempotent fan-out), got %.0f", countBefore, countAfter))
		}

		readAllRes, err := ctx.Call(ctx.Native, "observer-read-all", httpclient.Request{
			Method: "PUT",
			Path:   "/notifications/read-all",
			Bearer: observer.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		_ = readAllRes

		finalCountRes, err := ctx.Call(ctx.Native, "observer-unread-count-after-read-all", httpclient.Request{
			Method: "GET",
			Path:   "/notifications/unread-count",
			Bearer: observer.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		if flt(asMap(finalCountRes.JSON), "unreadCount") != 0 {
			ctx.Fail("observer-unread-count-after-read-all", httpclient.Request{}, finalCountRes, "expected unread count 0 after read-all")
		}

		_, err = ctx.Call(ctx.Native, "put-notification-settings", httpclient.Request{
			Method: "PUT",
			Path:   "/notifications/settings",
			Bearer: observer.AccessToken,
			Body: map[string]any{
				"habitReminders":   true,
				"friendActivity":   false,
				"challengeUpdates": true,
			},
		}, 200)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "register-web-push-device", httpclient.Request{
			Method: "POST",
			Path:   "/notifications/devices",
			Bearer: observer.AccessToken,
			Body: map[string]any{
				"platform": "web_push",
				"token":    `{"endpoint":"https://example.test/push/parity","keys":{"p256dh":"parity-p256dh","auth":"parity-auth"}}`,
				"deviceId": "parity-web-device-1",
			},
		}, 201)
		if err != nil {
			return err
		}

		// expo_push must remain an accepted platform value (preserved stub).
		_, err = ctx.Call(ctx.Native, "register-expo-push-device-stub", httpclient.Request{
			Method: "POST",
			Path:   "/notifications/devices",
			Bearer: observer.AccessToken,
			Body: map[string]any{
				"platform": "expo_push",
				"token":    "ExponentPushToken[parity-fake-token]",
				"deviceId": "parity-expo-device-1",
			},
		}, 201)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "delete-web-push-device", httpclient.Request{
			Method: "DELETE",
			Path:   "/notifications/devices",
			Bearer: observer.AccessToken,
			Body:   map[string]any{"deviceId": "parity-web-device-1"},
		}, 204)
		if err != nil {
			return err
		}

		// The local dev stack does not set WebPush keys (documented ground
		// truth), so this legitimately returns 404 here; on a stack with keys
		// configured (e.g. Railway) it returns 200 {publicKey}.
		_, err = ctx.Call(ctx.Native, "get-vapid-public-key", httpclient.Request{
			Method: "GET",
			Path:   "/notifications/vapid-public-key",
		}, 200, 404)
		return err
	},
}

func init() {
	registerAll(notificationsLifecycle)
}
