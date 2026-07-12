//go:build integration

package activity_test

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/social"
)

func TestFeed_HappyPath_EmptyFeed(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "empty@example.com", "emptyuser")

	status, body := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed",
		headers: bearerFor(t, stack.tokens, user.User.ID),
	})
	if status != http.StatusOK {
		t.Fatalf("status = %d, body = %v", status, body)
	}
	items := feedItems(body)
	// user.registered creates one entry for self
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1 (user.registered)", len(items))
	}
	if items[0]["eventType"] != "user.registered" {
		t.Errorf("eventType = %v, want user.registered", items[0]["eventType"])
	}
	if body["hasMore"] != false {
		t.Errorf("hasMore = %v, want false", body["hasMore"])
	}
	if body["nextCursor"] != nil {
		t.Errorf("nextCursor = %v, want null", body["nextCursor"])
	}
}

func TestFeed_HappyPath_KeysetPagination(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "page@example.com", "pageuser")

	// Seed 5 habit.created entries with distinct timestamps via direct emit.
	base := time.Now().UTC().Add(-time.Hour)
	for i := 0; i < 5; i++ {
		habitID := createHabit(t, stack, user.User.ID, "Habit")
		_ = habitID
		_ = base.Add(time.Duration(i) * time.Minute)
	}

	status1, body1 := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed?limit=3",
		headers: bearerFor(t, stack.tokens, user.User.ID),
	})
	if status1 != http.StatusOK {
		t.Fatalf("page1 status = %d", status1)
	}
	items1 := feedItems(body1)
	if len(items1) != 3 {
		t.Fatalf("page1 items = %d, want 3", len(items1))
	}
	if body1["hasMore"] != true {
		t.Fatalf("page1 hasMore = %v, want true", body1["hasMore"])
	}
	next, _ := body1["nextCursor"].(string)
	if next == "" {
		t.Fatal("page1 nextCursor empty")
	}

	status2, body2 := doRequest(t, stack.srv, testRequest{
		method:  http.MethodGet,
		path:    "/activity/feed?limit=3&cursor=" + url.QueryEscape(next),
		headers: bearerFor(t, stack.tokens, user.User.ID),
	})
	if status2 != http.StatusOK {
		t.Fatalf("page2 status = %d", status2)
	}
	items2 := feedItems(body2)
	if len(items2) == 0 {
		t.Fatal("page2 empty")
	}
	// No overlap between pages.
	seen := map[string]bool{}
	for _, it := range items1 {
		seen[it["id"].(string)] = true
	}
	for _, it := range items2 {
		if seen[it["id"].(string)] {
			t.Errorf("page2 id %v also on page1", it["id"])
		}
	}
}

func TestFeed_ErrorCase_InvalidLimitAndCursor(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "badq@example.com", "badquser")
	headers := bearerFor(t, stack.tokens, user.User.ID)

	status, body := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed?limit=0", headers: headers,
	})
	if status != http.StatusBadRequest {
		t.Errorf("limit=0 status = %d, want 400; body=%v", status, body)
	}

	status, body = doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed?limit=-1", headers: headers,
	})
	if status != http.StatusBadRequest {
		t.Errorf("limit=-1 status = %d, want 400; body=%v", status, body)
	}

	status, body = doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed?cursor=not-a-date", headers: headers,
	})
	if status != http.StatusBadRequest {
		t.Errorf("bad cursor status = %d, want 400; body=%v", status, body)
	}
}

func TestFeed_HappyPath_NameJoinShape(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "names@example.com", "namesuser")

	status, body := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed",
		headers: bearerFor(t, stack.tokens, user.User.ID),
	})
	if status != http.StatusOK {
		t.Fatalf("status = %d", status)
	}
	items := feedItems(body)
	if len(items) < 1 {
		t.Fatal("expected at least user.registered")
	}
	item := items[0]
	if item["actorUsername"] != "namesuser" {
		t.Errorf("actorUsername = %v, want namesuser", item["actorUsername"])
	}
	if item["actorDisplayName"] != "namesuser Display" {
		t.Errorf("actorDisplayName = %v, want namesuser Display", item["actorDisplayName"])
	}
	if item["actorId"] != user.User.ID {
		t.Errorf("actorId = %v, want %s", item["actorId"], user.User.ID)
	}
}

func TestFeed_HappyPath_PrivateHabitInvisibleToFriends(t *testing.T) {
	stack := newTestStack(t)
	alice := registerUser(t, stack.authService, "alice@example.com", "alicefeed")
	bob := registerUser(t, stack.authService, "bob@example.com", "bobfeed")
	makeFriends(t, stack, alice.User.ID, bob.User.ID)

	habitID := createHabit(t, stack, alice.User.ID, "Secret")
	if _, err := stack.socialService.SetHabitVisibility(context.Background(), alice.User.ID, habitID, social.VisibilityPrivate); err != nil {
		t.Fatalf("SetHabitVisibility: %v", err)
	}

	// Bob should not see alice's habit.created (private).
	status, body := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed?limit=50",
		headers: bearerFor(t, stack.tokens, bob.User.ID),
	})
	if status != http.StatusOK {
		t.Fatalf("status = %d", status)
	}
	for _, it := range feedItems(body) {
		if it["eventType"] == "habit.created" && it["actorId"] == alice.User.ID {
			t.Fatalf("bob saw alice's private habit.created: %v", it)
		}
	}
}

func TestFeed_HappyPath_PublicHabitVisibleToFriends(t *testing.T) {
	stack := newTestStack(t)
	alice := registerUser(t, stack.authService, "alice2@example.com", "alicepub")
	bob := registerUser(t, stack.authService, "bob2@example.com", "bobpub")
	makeFriends(t, stack, alice.User.ID, bob.User.ID)

	habitID := createHabit(t, stack, alice.User.ID, "PublicHabit")
	if _, err := stack.socialService.SetHabitVisibility(context.Background(), alice.User.ID, habitID, social.VisibilityPublic); err != nil {
		t.Fatalf("SetHabitVisibility: %v", err)
	}

	status, body := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed?limit=50",
		headers: bearerFor(t, stack.tokens, bob.User.ID),
	})
	if status != http.StatusOK {
		t.Fatalf("status = %d", status)
	}
	found := false
	for _, it := range feedItems(body) {
		if it["eventType"] == "habit.created" && it["actorId"] == alice.User.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("bob did not see alice's public habit.created")
	}
}

func TestFeed_EdgeCase_Unauthenticated(t *testing.T) {
	stack := newTestStack(t)
	status, _ := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed",
	})
	if status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", status)
	}
}

func TestFeed_HappyPath_SelfSeesOwnPrivateHabits(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "self@example.com", "selfuser")
	habitID := createHabit(t, stack, user.User.ID, "Mine")
	if _, err := stack.socialService.SetHabitVisibility(context.Background(), user.User.ID, habitID, social.VisibilityPrivate); err != nil {
		t.Fatalf("SetHabitVisibility: %v", err)
	}

	status, body := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed?limit=50",
		headers: bearerFor(t, stack.tokens, user.User.ID),
	})
	if status != http.StatusOK {
		t.Fatalf("status = %d", status)
	}
	found := false
	for _, it := range feedItems(body) {
		if it["eventType"] == "habit.created" {
			found = true
		}
	}
	if !found {
		t.Fatal("self should always see own habit entries")
	}
}

// Ensure friend.request.accepted from makeFriends shows for both (non-habit events).
func TestFeed_HappyPath_NonHabitEventsAlwaysVisible(t *testing.T) {
	stack := newTestStack(t)
	alice := registerUser(t, stack.authService, "alice3@example.com", "alicefr")
	bob := registerUser(t, stack.authService, "bob3@example.com", "bobfr")
	makeFriends(t, stack, alice.User.ID, bob.User.ID)

	status, body := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed?limit=50",
		headers: bearerFor(t, stack.tokens, bob.User.ID),
	})
	if status != http.StatusOK {
		t.Fatalf("status = %d", status)
	}
	found := false
	for _, it := range feedItems(body) {
		if it["eventType"] == "friend.request.accepted" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected friend.request.accepted in bob's feed")
	}
}

func TestFeed_EdgeCase_LimitClampedTo100(t *testing.T) {
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "clamp@example.com", "clampuser")
	status, body := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed?limit=999",
		headers: bearerFor(t, stack.tokens, user.User.ID),
	})
	if status != http.StatusOK {
		t.Fatalf("status = %d body=%v", status, body)
	}
}

// TestFeed_HappyPath_VisibilityCacheMergesAcrossBatches forces the feed's
// multi-batch loop: iteration 1 only sees a friend's private habit (cached
// as not-visible); iteration 2 introduces a different public habit for the
// same friend. The per-(friend,habitID) cache must MERGE — a friend-level
// cache would permanently hide the public habit (REVIEW ROUND 1 FIX A).
func TestFeed_HappyPath_VisibilityCacheMergesAcrossBatches(t *testing.T) {
	stack := newTestStack(t)
	alice := registerUser(t, stack.authService, "cache-a@example.com", "cachealice")
	bob := registerUser(t, stack.authService, "cache-b@example.com", "cachebob")
	makeFriends(t, stack, alice.User.ID, bob.User.ID)

	privateHabit := createHabit(t, stack, alice.User.ID, "PrivateMany")
	publicHabit := createHabit(t, stack, alice.User.ID, "PublicLate")
	if _, err := stack.socialService.SetHabitVisibility(context.Background(), alice.User.ID, privateHabit, social.VisibilityPrivate); err != nil {
		t.Fatalf("private: %v", err)
	}
	if _, err := stack.socialService.SetHabitVisibility(context.Background(), alice.User.ID, publicHabit, social.VisibilityPublic); err != nil {
		t.Fatalf("public: %v", err)
	}

	// Wipe auto-emitted rows so we control created_at ordering exactly.
	if _, err := stack.pool.Exec(context.Background(), `DELETE FROM feed_entries`); err != nil {
		t.Fatalf("clear feed: %v", err)
	}

	base := time.Now().UTC()
	// limit=1 → batchSize=4. Five private entries fill batch 1 and spill into
	// batch 2; the public habit is older so it only appears in a later batch,
	// after the friend is already in the visibility cache.
	for i := 0; i < 5; i++ {
		seedFeedEntry(t, stack, alice.User.ID, "habit.completed",
			fmt.Sprintf(`{"userId":%q,"habitId":%q,"consistency":0.5}`, alice.User.ID, privateHabit),
			base.Add(time.Duration(10-i)*time.Minute))
	}
	seedFeedEntry(t, stack, alice.User.ID, "habit.created",
		fmt.Sprintf(`{"userId":%q,"habitId":%q,"name":"PublicLate"}`, alice.User.ID, publicHabit),
		base.Add(time.Minute))

	status, body := doRequest(t, stack.srv, testRequest{
		method: http.MethodGet, path: "/activity/feed?limit=1",
		headers: bearerFor(t, stack.tokens, bob.User.ID),
	})
	if status != http.StatusOK {
		t.Fatalf("status = %d body=%v", status, body)
	}
	items := feedItems(body)
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1 (first visible = public habit)", len(items))
	}
	if items[0]["eventType"] != "habit.created" {
		t.Fatalf("eventType = %v, want habit.created", items[0]["eventType"])
	}
	data, _ := items[0]["data"].(map[string]any)
	if data["habitId"] != publicHabit {
		t.Fatalf("habitId = %v, want public habit %s (cache must not hide it)", data["habitId"], publicHabit)
	}
}
