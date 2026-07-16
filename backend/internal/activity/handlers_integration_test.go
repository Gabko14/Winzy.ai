//go:build integration

package activity_test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/db"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/social"
)

func TestHandlers_HappyPath_IdempotentReplay(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "idem@example.com", "idemuser")
	habitID := "11111111-1111-1111-1111-111111111111"

	evt := events.HabitCreated{UserID: user.User.ID, HabitID: habitID, Name: "Twice"}
	if err := events.Emit(context.Background(), stack.registry, evt); err != nil {
		t.Fatalf("emit1: %v", err)
	}
	if err := events.Emit(context.Background(), stack.registry, evt); err != nil {
		t.Fatalf("emit2: %v", err)
	}

	var n int
	if err := stack.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM feed_entries
		WHERE actor_id = $1::uuid AND event_type = 'habit.created'
			AND data->>'habitId' = $2 AND deleted_at IS NULL`,
		user.User.ID, habitID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("count = %d, want 1 after replay", n)
	}
}

func TestHandlers_HappyPath_FriendAcceptedPairAtomicUnderOwnTx(t *testing.T) {
	t.Parallel()
	// FriendRequestAccepted arrives post-commit (pool querier) — handler must
	// open its own tx so both inserts commit together (REVIEW ROUND 1 FIX B).
	stack := newTestStack(t)
	a := registerUser(t, stack.authService, "pair1@example.com", "pairone")
	b := registerUser(t, stack.authService, "pair2@example.com", "pairtwo")

	if err := events.Emit(context.Background(), stack.registry, events.FriendRequestAccepted{
		UserID1: a.User.ID, UserID2: b.User.ID,
	}); err != nil {
		t.Fatalf("emit: %v", err)
	}

	var n int
	if err := stack.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM feed_entries
		WHERE event_type = 'friend.request.accepted'
			AND deleted_at IS NULL
			AND (actor_id = $1::uuid OR actor_id = $2::uuid)`,
		a.User.ID, b.User.ID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 2 {
		t.Fatalf("pair count = %d, want 2", n)
	}
}

// TestHandlers_HappyPath_FriendAcceptedHealsOrphanKey2 covers the replay path
// after a historical crash left only entry1: re-emit must insert the missing
// key2 instead of early-returning on the key1 duplicate.
func TestHandlers_HappyPath_FriendAcceptedHealsOrphanKey2(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := registerUser(t, stack.authService, "heal1@example.com", "healone")
	b := registerUser(t, stack.authService, "heal2@example.com", "healtwo")

	pairKey := a.User.ID + ":" + b.User.ID
	if a.User.ID > b.User.ID {
		pairKey = b.User.ID + ":" + a.User.ID
	}
	key1 := "friend.request.accepted:" + pairKey + ":1"
	payload := fmt.Sprintf(`{"userId1":%q,"userId2":%q}`, a.User.ID, b.User.ID)
	if _, err := stack.pool.Exec(context.Background(), `
		INSERT INTO feed_entries (actor_id, event_type, data, idempotency_key)
		VALUES ($1::uuid, 'friend.request.accepted', $2::jsonb, $3)`,
		a.User.ID, payload, key1); err != nil {
		t.Fatalf("seed orphan key1: %v", err)
	}

	if err := events.Emit(context.Background(), stack.registry, events.FriendRequestAccepted{
		UserID1: a.User.ID, UserID2: b.User.ID,
	}); err != nil {
		t.Fatalf("emit heal: %v", err)
	}

	var n int
	if err := stack.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM feed_entries
		WHERE event_type = 'friend.request.accepted'
			AND deleted_at IS NULL
			AND (actor_id = $1::uuid OR actor_id = $2::uuid)`,
		a.User.ID, b.User.ID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 2 {
		t.Fatalf("after heal count = %d, want 2", n)
	}
}

func TestHandlers_HappyPath_VisibilityNarrowingAndWidening(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "vis@example.com", "visuser")
	habitID := createHabit(t, stack, user.User.ID, "Toggle")

	// Default visibility after habit.created is typically Private from social
	// preferences — set Public first so narrowing Public→Private soft-deletes.
	if _, err := stack.socialService.SetHabitVisibility(context.Background(), user.User.ID, habitID, social.VisibilityPublic); err != nil {
		t.Fatalf("set public: %v", err)
	}

	countActive := func() int {
		t.Helper()
		var n int
		if err := stack.pool.QueryRow(context.Background(), `
			SELECT COUNT(*) FROM feed_entries
			WHERE actor_id = $1::uuid AND deleted_at IS NULL
				AND event_type IN ('habit.created','habit.completed')
				AND data->>'habitId' = $2`,
			user.User.ID, habitID).Scan(&n); err != nil {
			t.Fatalf("count active: %v", err)
		}
		return n
	}
	countSoft := func() int {
		t.Helper()
		var n int
		if err := stack.pool.QueryRow(context.Background(), `
			SELECT COUNT(*) FROM feed_entries
			WHERE actor_id = $1::uuid AND deleted_at IS NOT NULL
				AND event_type IN ('habit.created','habit.completed')
				AND data->>'habitId' = $2`,
			user.User.ID, habitID).Scan(&n); err != nil {
			t.Fatalf("count soft: %v", err)
		}
		return n
	}

	if got := countActive(); got < 1 {
		t.Fatalf("expected active habit entries before narrowing, got %d", got)
	}

	if _, err := stack.socialService.SetHabitVisibility(context.Background(), user.User.ID, habitID, social.VisibilityPrivate); err != nil {
		t.Fatalf("narrow: %v", err)
	}
	if got := countActive(); got != 0 {
		t.Fatalf("after narrowing active = %d, want 0", got)
	}
	if got := countSoft(); got < 1 {
		t.Fatalf("after narrowing soft-deleted = %d, want >=1", got)
	}

	if _, err := stack.socialService.SetHabitVisibility(context.Background(), user.User.ID, habitID, social.VisibilityFriends); err != nil {
		t.Fatalf("widen: %v", err)
	}
	if got := countActive(); got < 1 {
		t.Fatalf("after widening active = %d, want >=1", got)
	}
	if got := countSoft(); got != 0 {
		t.Fatalf("after widening soft-deleted = %d, want 0", got)
	}
}

func TestHandlers_HappyPath_FriendRemovedSoftDeletesAccepted(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := registerUser(t, stack.authService, "rm1@example.com", "rmone")
	b := registerUser(t, stack.authService, "rm2@example.com", "rmtwo")
	makeFriends(t, stack, a.User.ID, b.User.ID)

	if err := stack.socialService.RemoveFriend(context.Background(), a.User.ID, b.User.ID); err != nil {
		t.Fatalf("RemoveFriend: %v", err)
	}

	var active, soft int
	if err := stack.pool.QueryRow(context.Background(), `
		SELECT
			COUNT(*) FILTER (WHERE deleted_at IS NULL),
			COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)
		FROM feed_entries
		WHERE event_type = 'friend.request.accepted'
			AND (actor_id = $1::uuid OR actor_id = $2::uuid)`,
		a.User.ID, b.User.ID).Scan(&active, &soft); err != nil {
		t.Fatalf("count: %v", err)
	}
	if active != 0 {
		t.Errorf("active friend.request.accepted = %d, want 0", active)
	}
	if soft != 2 {
		t.Errorf("soft-deleted friend.request.accepted = %d, want 2", soft)
	}
}

func TestHandlers_HappyPath_UserDeletedHardDeletes(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := registerUser(t, stack.authService, "del1@example.com", "delone")
	b := registerUser(t, stack.authService, "del2@example.com", "deltwo")
	makeFriends(t, stack, a.User.ID, b.User.ID)
	_ = createHabit(t, stack, a.User.ID, "Gone")

	if err := events.Emit(context.Background(), stack.registry, events.UserDeleted{UserID: a.User.ID}); err != nil {
		t.Fatalf("UserDeleted: %v", err)
	}

	var actorLeft int
	if err := stack.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM feed_entries WHERE actor_id = $1::uuid`,
		a.User.ID).Scan(&actorLeft); err != nil {
		t.Fatalf("actor count: %v", err)
	}
	if actorLeft != 0 {
		t.Fatalf("actor entries left = %d, want 0 (hard delete)", actorLeft)
	}

	var refLeft int
	if err := stack.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM feed_entries
		WHERE data IS NOT NULL AND (
			data->>'userId' = $1 OR data->>'userId1' = $1 OR data->>'userId2' = $1
			OR data->>'fromUserId' = $1 OR data->>'toUserId' = $1
		)`, a.User.ID).Scan(&refLeft); err != nil {
		t.Fatalf("ref count: %v", err)
	}
	if refLeft != 0 {
		t.Fatalf("referencing entries left = %d, want 0", refLeft)
	}
}

func TestHandlers_EdgeCase_SoftDeleteInvisibleOnAllReadPaths(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "soft@example.com", "softuser")
	habitID := createHabit(t, stack, user.User.ID, "HideMe")

	if _, err := stack.socialService.SetHabitVisibility(context.Background(), user.User.ID, habitID, social.VisibilityPublic); err != nil {
		t.Fatalf("public: %v", err)
	}
	if _, err := stack.socialService.SetHabitVisibility(context.Background(), user.User.ID, habitID, social.VisibilityPrivate); err != nil {
		t.Fatalf("narrow: %v", err)
	}

	// Feed path
	status, body := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/activity/feed?limit=50",
		headers: bearerFor(t, stack.tokens, user.User.ID),
	})
	if status != 200 {
		t.Fatalf("feed status = %d", status)
	}
	for _, it := range feedItems(body) {
		if it["eventType"] == "habit.created" {
			data, _ := json.Marshal(it["data"])
			var payload struct {
				HabitID string `json:"habitId"`
			}
			_ = json.Unmarshal(data, &payload)
			if payload.HabitID == habitID {
				t.Fatal("soft-deleted habit.created visible on feed")
			}
		}
	}

	// Export path
	sections, _ := stack.exportReg.Export(context.Background(), user.User.ID)
	for _, sec := range sections {
		if sec.Service != "activity" {
			continue
		}
		raw, _ := json.Marshal(sec.Data)
		var data struct {
			FeedEntries []struct {
				EventType string          `json:"eventType"`
				Data      json.RawMessage `json:"data"`
			} `json:"feedEntries"`
		}
		if err := json.Unmarshal(raw, &data); err != nil {
			t.Fatalf("unmarshal export: %v", err)
		}
		for _, e := range data.FeedEntries {
			if e.EventType != "habit.created" {
				continue
			}
			var payload struct {
				HabitID string `json:"habitId"`
			}
			_ = json.Unmarshal(e.Data, &payload)
			if payload.HabitID == habitID {
				t.Fatal("soft-deleted habit.created visible on export")
			}
		}
	}
}

func TestExport_HappyPath_AndErrNoData(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "exp@example.com", "expuser")

	sections, warnings := stack.exportReg.Export(context.Background(), user.User.ID)
	if len(warnings) != 0 {
		t.Errorf("warnings = %v", warnings)
	}
	found := false
	for _, sec := range sections {
		if sec.Service == "activity" {
			found = true
			raw, _ := json.Marshal(sec.Data)
			var data struct {
				FeedEntries []map[string]any `json:"feedEntries"`
			}
			if err := json.Unmarshal(raw, &data); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if len(data.FeedEntries) < 1 {
				t.Fatal("expected feedEntries")
			}
			entry := data.FeedEntries[0]
			for _, key := range []string{"id", "eventType", "data", "createdAt"} {
				if _, ok := entry[key]; !ok {
					t.Errorf("export entry missing %s", key)
				}
			}
			if _, ok := entry["actorUsername"]; ok {
				t.Error("export must not include actorUsername (C# shape)")
			}
		}
	}
	if !found {
		t.Fatal("activity export section missing")
	}

	// ErrNoData path: user with only soft-deleted entries after hard-clear via UserDeleted
	orphan := "99999999-9999-9999-9999-999999999999"
	sections2, _ := stack.exportReg.Export(context.Background(), orphan)
	for _, sec := range sections2 {
		if sec.Service == "activity" {
			t.Fatal("expected no activity section for empty user")
		}
	}
}

func TestHandlers_HappyPath_ChallengeAndCompletedPayloads(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "ch@example.com", "chuser")
	friend := registerUser(t, stack.authService, "chf@example.com", "chfriend")
	makeFriends(t, stack, user.User.ID, friend.User.ID)

	challengeID := "22222222-2222-2222-2222-222222222222"
	habitID := "33333333-3333-3333-3333-333333333333"

	if err := events.Emit(context.Background(), stack.registry, events.ChallengeCreated{
		ChallengeID: challengeID, From: user.User.ID, To: friend.User.ID, HabitID: habitID,
	}); err != nil {
		t.Fatalf("ChallengeCreated: %v", err)
	}
	if err := events.Emit(context.Background(), stack.registry, events.ChallengeCompleted{
		ChallengeID: challengeID, UserID: friend.User.ID, Reward: "coffee",
	}); err != nil {
		t.Fatalf("ChallengeCompleted: %v", err)
	}

	var createdData, completedData []byte
	if err := stack.pool.QueryRow(context.Background(), `
		SELECT data FROM feed_entries
		WHERE event_type = 'challenge.created' AND idempotency_key = $1`,
		"challenge.created:"+challengeID).Scan(&createdData); err != nil {
		t.Fatalf("created: %v", err)
	}
	var created map[string]any
	_ = json.Unmarshal(createdData, &created)
	for _, k := range []string{"challengeId", "fromUserId", "toUserId", "habitId"} {
		if _, ok := created[k]; !ok {
			t.Errorf("challenge.created data missing %s", k)
		}
	}

	if err := stack.pool.QueryRow(context.Background(), `
		SELECT data FROM feed_entries
		WHERE event_type = 'challenge.completed' AND idempotency_key = $1`,
		"challenge.completed:"+challengeID).Scan(&completedData); err != nil {
		t.Fatalf("completed: %v", err)
	}
	var completed map[string]any
	_ = json.Unmarshal(completedData, &completed)
	if completed["reward"] != "coffee" {
		t.Errorf("reward = %v, want coffee", completed["reward"])
	}
}

func TestHandlers_HappyPath_HabitCompletedIdempotencyKeyUsesDate(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "hc@example.com", "hcuser")
	habitID := "44444444-4444-4444-4444-444444444444"
	day := time.Date(2026, 7, 12, 15, 30, 0, 0, time.UTC)

	evt := events.HabitCompleted{
		UserID: user.User.ID, HabitID: habitID, Date: day, Consistency: 0.5,
	}
	if err := events.Emit(context.Background(), stack.registry, evt); err != nil {
		t.Fatalf("emit1: %v", err)
	}
	// Same civil date, different clock time — same idempotency key.
	evt.Date = day.Add(2 * time.Hour)
	evt.Consistency = 0.9
	if err := events.Emit(context.Background(), stack.registry, evt); err != nil {
		t.Fatalf("emit2: %v", err)
	}

	var n int
	if err := stack.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM feed_entries
		WHERE idempotency_key = $1`,
		"habit.completed:"+user.User.ID+":"+habitID+":2026-07-12").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("count = %d, want 1", n)
	}
}

func TestHandlers_EdgeCase_InTxQuerierFrom(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "tx@example.com", "txuser")

	tx, err := stack.pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(context.Background())

	ctx := db.WithQuerier(context.Background(), tx)
	habitID := "55555555-5555-5555-5555-555555555555"
	if err := events.Emit(ctx, stack.registry, events.HabitCreated{
		UserID: user.User.ID, HabitID: habitID, Name: "InTx",
	}); err != nil {
		t.Fatalf("emit in tx: %v", err)
	}
	// Rollback — row must vanish.
	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatalf("rollback: %v", err)
	}

	var n int
	if err := stack.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM feed_entries
		WHERE data->>'habitId' = $1`, habitID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("after rollback count = %d, want 0 (QuerierFrom joined tx)", n)
	}
}

func TestExport_ErrorCase_ErrNoDataSentinel(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	orphan := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	sections, _ := stack.exportReg.Export(context.Background(), orphan)
	for _, sec := range sections {
		if sec.Service == "activity" {
			t.Fatal("activity section should be omitted on ErrNoData")
		}
	}
}
