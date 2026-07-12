//go:build integration

package challenges_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/challenges"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

func TestCreateChallenge_HappyPath_Returns201(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator1@example.com", "creator1")
	recipient := registerUser(t, stack.authService, "recip1@example.com", "recip1")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	status, body := doRequest(t, stack.srv, testRequest{
		method:  "POST",
		path:    "/challenges",
		headers: bearerFor(t, stack.tokens, creator.User.ID),
		body: map[string]any{
			"habitId": habitID, "recipientId": recipient.User.ID,
			"milestoneType": "consistencyTarget", "targetValue": 80.0,
			"periodDays": 30, "rewardDescription": "Coffee together!",
		},
	})
	if status != 201 {
		t.Fatalf("status=%d body=%v", status, body)
	}
	if body["status"] != "active" {
		t.Fatalf("status=%v", body["status"])
	}
	if body["milestoneType"] != "consistencyTarget" {
		t.Fatalf("milestoneType=%v", body["milestoneType"])
	}
}

func TestCreateChallenge_ErrorCase_NotFriends_Returns400(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator2@example.com", "creator2")
	stranger := registerUser(t, stack.authService, "stranger2@example.com", "stranger2")
	habitID := createHabit(t, stack, stranger.User.ID, "Run")

	status, body := doRequest(t, stack.srv, testRequest{
		method:  "POST",
		path:    "/challenges",
		headers: bearerFor(t, stack.tokens, creator.User.ID),
		body: map[string]any{
			"habitId": habitID, "recipientId": stranger.User.ID,
			"milestoneType": 0, "targetValue": 80.0,
			"periodDays": 30, "rewardDescription": "Coffee",
		},
	})
	if status != 400 || body["error"] != "You can only challenge friends" {
		t.Fatalf("status=%d body=%v", status, body)
	}
}

func TestCreateChallenge_ErrorCase_SelfChallenge_Returns400(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator3@example.com", "creator3")
	habitID := createHabit(t, stack, creator.User.ID, "Run")

	status, body := doRequest(t, stack.srv, testRequest{
		method:  "POST",
		path:    "/challenges",
		headers: bearerFor(t, stack.tokens, creator.User.ID),
		body: map[string]any{
			"habitId": habitID, "recipientId": creator.User.ID,
			"milestoneType": 0, "targetValue": 80.0,
			"periodDays": 30, "rewardDescription": "Self",
		},
	})
	if status != 400 || body["error"] != "Cannot challenge yourself" {
		t.Fatalf("status=%d body=%v", status, body)
	}
}

func TestCreateChallenge_ErrorCase_UniqueActiveConflict_Returns409(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator4@example.com", "creator4")
	recipient := registerUser(t, stack.authService, "recip4@example.com", "recip4")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	body := map[string]any{
		"habitId": habitID, "recipientId": recipient.User.ID,
		"milestoneType": 0, "targetValue": 80.0,
		"periodDays": 30, "rewardDescription": "Coffee",
	}
	status, _ := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges",
		headers: bearerFor(t, stack.tokens, creator.User.ID), body: body,
	})
	if status != 201 {
		t.Fatalf("first create status=%d", status)
	}
	status, resp := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges",
		headers: bearerFor(t, stack.tokens, creator.User.ID), body: body,
	})
	if status != 409 || resp["error"] != "An active challenge already exists for this habit and recipient" {
		t.Fatalf("status=%d body=%v", status, resp)
	}
}

func TestCreateChallenge_ErrorCase_NullBody_Returns400(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator5@example.com", "creator5")
	status, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges",
		headers: bearerFor(t, stack.tokens, creator.User.ID),
		body:    []byte("null"),
	})
	if status != 400 || body["error"] != "Request body is required" {
		t.Fatalf("status=%d body=%v", status, body)
	}
}

func TestCreateChallenge_ErrorCase_MalformedJSON_Returns400(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator6@example.com", "creator6")
	status, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges",
		headers: bearerFor(t, stack.tokens, creator.User.ID),
		body:    []byte("{not json"),
	})
	if status != 400 || body["error"] != "Invalid JSON in request body" {
		t.Fatalf("status=%d body=%v", status, body)
	}
}

func TestListChallenges_DerivedExpiredFilter(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator7@example.com", "creator7")
	recipient := registerUser(t, stack.authService, "recip7@example.com", "recip7")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	fixedNow := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)
	stack.challengesService.SetClock(func() time.Time { return fixedNow })

	_, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneConsistencyTarget, TargetValue: 80,
		PeriodDays: 1, RewardDescription: "Soon",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Advance clock past EndsAt so Active becomes derived Expired.
	stack.challengesService.SetClock(func() time.Time { return fixedNow.Add(48 * time.Hour) })

	status, body := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges?status=expired",
		headers: bearerFor(t, stack.tokens, creator.User.ID),
	})
	if status != 200 {
		t.Fatalf("status=%d body=%v", status, body)
	}
	if int(body["total"].(float64)) != 1 {
		t.Fatalf("total=%v want 1", body["total"])
	}
}

func TestClaimAndCancel_Permissions(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator8@example.com", "creator8")
	recipient := registerUser(t, stack.authService, "recip8@example.com", "recip8")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	ch, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneConsistencyTarget, TargetValue: 50,
		PeriodDays: 30, RewardDescription: "Coffee",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Claim while still Active -> 400
	status, body := doRequest(t, stack.srv, testRequest{
		method: "PUT", path: "/challenges/" + ch.ID + "/claim",
		headers: bearerFor(t, stack.tokens, recipient.User.ID),
	})
	if status != 400 || body["error"] != "Only completed challenges can be claimed" {
		t.Fatalf("claim active: %d %v", status, body)
	}

	// Stranger cannot cancel
	stranger := registerUser(t, stack.authService, "stranger8@example.com", "stranger8")
	status, _ = doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/challenges/" + ch.ID,
		headers: bearerFor(t, stack.tokens, stranger.User.ID),
	})
	if status != 404 {
		t.Fatalf("stranger cancel status=%d", status)
	}

	// Creator cancels
	status, _ = doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/challenges/" + ch.ID,
		headers: bearerFor(t, stack.tokens, creator.User.ID),
	})
	if status != 204 {
		t.Fatalf("cancel status=%d", status)
	}
}

func TestProgressEngine_ProcessedDatesDedupe(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator9@example.com", "creator9")
	recipient := registerUser(t, stack.authService, "recip9@example.com", "recip9")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	ch, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneDaysInPeriod, TargetValue: 5,
		PeriodDays: 30, RewardDescription: "Tennis",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Completion date must be on/after challenge.CreatedAt's UTC civil date
	// (HabitCompletedSubscriber.cs DaysInPeriod gate).
	day := ch.CreatedAt.UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	evt := events.HabitCompleted{
		UserID: recipient.User.ID, HabitID: habitID, Date: day, Consistency: 40,
	}
	if err := events.Emit(context.Background(), stack.registry, evt); err != nil {
		t.Fatalf("first emit: %v", err)
	}
	if err := events.Emit(context.Background(), stack.registry, evt); err != nil {
		t.Fatalf("replay emit: %v", err)
	}

	detail, err := stack.challengesService.Get(context.Background(), creator.User.ID, ch.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if detail.CompletionCount != 1 {
		t.Fatalf("completionCount=%d want 1 after dedupe", detail.CompletionCount)
	}
}

func TestProgressEngine_ImprovementBaselineCapture(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator10@example.com", "creator10")
	recipient := registerUser(t, stack.authService, "recip10@example.com", "recip10")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	ch, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneImprovementMilestone, TargetValue: 20,
		PeriodDays: 30, RewardDescription: "Walk",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Before creation date — must not capture baseline
	before := ch.CreatedAt.UTC().Add(-48 * time.Hour)
	_ = events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: recipient.User.ID, HabitID: habitID, Date: before, Consistency: 10,
	})
	detail, _ := stack.challengesService.Get(context.Background(), creator.User.ID, ch.ID)
	if detail.BaselineConsistency != nil {
		t.Fatalf("baseline should be nil, got %v", *detail.BaselineConsistency)
	}

	after := ch.CreatedAt.UTC().Add(time.Hour)
	_ = events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: recipient.User.ID, HabitID: habitID, Date: after, Consistency: 45,
	})
	detail, err = stack.challengesService.Get(context.Background(), creator.User.ID, ch.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if detail.BaselineConsistency == nil || *detail.BaselineConsistency != 45 {
		t.Fatalf("baseline=%v want 45", detail.BaselineConsistency)
	}
}

func TestProgressEngine_DaysInPeriod_SkipsPreCreationDate(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator14@example.com", "creator14")
	recipient := registerUser(t, stack.authService, "recip14@example.com", "recip14")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	ch, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneDaysInPeriod, TargetValue: 5,
		PeriodDays: 30, RewardDescription: "Gate",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	before := ch.CreatedAt.UTC().Add(-24 * time.Hour)
	if err := events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: recipient.User.ID, HabitID: habitID, Date: before, Consistency: 40,
	}); err != nil {
		t.Fatalf("emit: %v", err)
	}
	detail, err := stack.challengesService.Get(context.Background(), creator.User.ID, ch.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if detail.CompletionCount != 0 {
		t.Fatalf("pre-creation date must not increment; count=%d", detail.CompletionCount)
	}
}

func TestProgressEngine_ConsistencyTarget_NoDateGate(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator15@example.com", "creator15")
	recipient := registerUser(t, stack.authService, "recip15@example.com", "recip15")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	ch, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneConsistencyTarget, TargetValue: 80,
		PeriodDays: 30, RewardDescription: "Live",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// ConsistencyTarget has NO creation-date gate — a backfilled date still
	// refreshes progress (HabitCompletedSubscriber.cs ConsistencyTarget path).
	before := ch.CreatedAt.UTC().Add(-72 * time.Hour)
	if err := events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: recipient.User.ID, HabitID: habitID, Date: before, Consistency: 40,
	}); err != nil {
		t.Fatalf("emit: %v", err)
	}
	detail, err := stack.challengesService.Get(context.Background(), creator.User.ID, ch.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if detail.Progress != 0.5 {
		t.Fatalf("progress=%v want 0.5 (40/80) despite pre-creation date", detail.Progress)
	}
}

func TestUserDeleted_CascadesChallenges(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator11@example.com", "creator11")
	recipient := registerUser(t, stack.authService, "recip11@example.com", "recip11")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	_, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneConsistencyTarget, TargetValue: 80,
		PeriodDays: 30, RewardDescription: "Coffee",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := stack.authService.DeleteAccount(context.Background(), creator.User.ID); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	status, body := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges",
		headers: bearerFor(t, stack.tokens, recipient.User.ID),
	})
	if status != 200 {
		t.Fatalf("status=%d", status)
	}
	if int(body["total"].(float64)) != 0 {
		t.Fatalf("total=%v want 0 after cascade", body["total"])
	}
}

func TestExportSection_ChallengeSingular(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator12@example.com", "creator12")
	recipient := registerUser(t, stack.authService, "recip12@example.com", "recip12")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	_, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneConsistencyTarget, TargetValue: 80,
		PeriodDays: 30, RewardDescription: "Coffee together!",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	sections, _ := stack.exportReg.Export(context.Background(), creator.User.ID)
	found := false
	for _, s := range sections {
		if s.Service == "challenge" {
			found = true
			raw, err := json.Marshal(s.Data)
			if err != nil {
				t.Fatalf("marshal export data: %v", err)
			}
			var parsed map[string]any
			if err := json.Unmarshal(raw, &parsed); err != nil {
				t.Fatalf("unmarshal export data: %v", err)
			}
			if parsed["challenges"] == nil {
				t.Fatalf("missing challenges in export data: %v", parsed)
			}
		}
	}
	if !found {
		t.Fatalf("challenge section missing; got %#v", sections)
	}

	// No-data user
	lonely := registerUser(t, stack.authService, "lonely12@example.com", "lonely12")
	sections, _ = stack.exportReg.Export(context.Background(), lonely.User.ID)
	for _, s := range sections {
		if s.Service == "challenge" {
			t.Fatal("expected ErrNoData omit for user with no challenges")
		}
	}
}

func TestProgressEngine_ConsistencyTargetCompletes(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "creator13@example.com", "creator13")
	recipient := registerUser(t, stack.authService, "recip13@example.com", "recip13")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	ch, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneConsistencyTarget, TargetValue: 50,
		PeriodDays: 30, RewardDescription: "Coffee",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	completed := make(chan events.ChallengeCompleted, 1)
	events.Register(stack.registry, func(_ context.Context, e events.ChallengeCompleted) error {
		completed <- e
		return nil
	})

	_ = events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: recipient.User.ID, HabitID: habitID,
		Date: time.Now().UTC(), Consistency: 60,
	})

	select {
	case e := <-completed:
		if e.ChallengeID != ch.ID || e.Reward != "Coffee" {
			t.Fatalf("event=%+v", e)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ChallengeCompleted not emitted")
	}

	status, body := doRequest(t, stack.srv, testRequest{
		method: "PUT", path: "/challenges/" + ch.ID + "/claim",
		headers: bearerFor(t, stack.tokens, recipient.User.ID),
	})
	if status != 200 || body["status"] != "claimed" {
		t.Fatalf("claim: %d %v", status, body)
	}
}

func TestCreateChallenge_CreatesHabitViaComplete(t *testing.T) {
	// Smoke: CompleteHabit still works with challenges handler registered.
	stack := newTestStack(t)
	user := registerUser(t, stack.authService, "completer@example.com", "completer")
	habitID := createHabit(t, stack, user.User.ID, "Run")
	_, _, err := stack.habitsService.CompleteHabit(context.Background(), user.User.ID, habitID, habits.CompleteHabitRequest{
		Timezone: "UTC",
	})
	if err != nil {
		t.Fatalf("CompleteHabit: %v", err)
	}
}

func TestCreateChallenge_CustomDateRange_ValidationErrors(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "cdra@example.com", "cdra")
	recipient := registerUser(t, stack.authService, "cdrb@example.com", "cdrb")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")
	headers := bearerFor(t, stack.tokens, creator.User.ID)

	status, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges", headers: headers,
		body: map[string]any{
			"habitId": habitID, "recipientId": recipient.User.ID,
			"milestoneType": "customDateRange", "targetValue": 80.0,
			"periodDays": 30, "rewardDescription": "Coffee",
		},
	})
	if status != 400 || body["error"] != "CustomStartDate and CustomEndDate are required for CustomDateRange" {
		t.Fatalf("missing dates: %d %v", status, body)
	}

	start := time.Now().UTC().Add(48 * time.Hour)
	end := time.Now().UTC().Add(24 * time.Hour) // end before start
	status, body = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges", headers: headers,
		body: map[string]any{
			"habitId": habitID, "recipientId": recipient.User.ID,
			"milestoneType": "customDateRange", "targetValue": 80.0,
			"periodDays": 30, "rewardDescription": "Coffee",
			"customStartDate": start.Format(time.RFC3339),
			"customEndDate":   end.Format(time.RFC3339),
		},
	})
	if status != 400 || body["error"] != "CustomEndDate must be after CustomStartDate" {
		t.Fatalf("end<=start: %d %v", status, body)
	}

	pastEnd := time.Now().UTC().Add(-24 * time.Hour)
	pastStart := time.Now().UTC().Add(-48 * time.Hour)
	status, body = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges", headers: headers,
		body: map[string]any{
			"habitId": habitID, "recipientId": recipient.User.ID,
			"milestoneType": "customDateRange", "targetValue": 80.0,
			"periodDays": 30, "rewardDescription": "Coffee",
			"customStartDate": pastStart.Format(time.RFC3339),
			"customEndDate":   pastEnd.Format(time.RFC3339),
		},
	})
	if status != 400 || body["error"] != "CustomEndDate must be in the future" {
		t.Fatalf("end in past: %d %v", status, body)
	}
}

func TestProgressEngine_CustomDateRange_RangeGateAndLiveConsistency(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "cdrc@example.com", "cdrc")
	recipient := registerUser(t, stack.authService, "cdrd@example.com", "cdrd")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	now := time.Now().UTC()
	rangeStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	rangeEnd := rangeStart.AddDate(0, 0, 30)
	ch, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneCustomDateRange, TargetValue: 100,
		PeriodDays: 30, RewardDescription: "Range coffee",
		CustomStartDate: &rangeStart, CustomEndDate: &rangeEnd,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Pre-range completion must not move progress.
	before := rangeStart.Add(-48 * time.Hour)
	if err := events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: recipient.User.ID, HabitID: habitID, Date: before, Consistency: 99, Timezone: "UTC",
	}); err != nil {
		t.Fatalf("pre-range emit: %v", err)
	}
	detail, err := stack.challengesService.Get(context.Background(), creator.User.ID, ch.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if detail.Progress != 0 || detail.CompletionCount != 0 {
		t.Fatalf("pre-range must be skipped; progress=%v count=%d", detail.Progress, detail.CompletionCount)
	}

	// In-range completion via CompleteHabit so ConsistencyForDateRange sees real rows.
	today := rangeStart.Format("2006-01-02")
	_, _, err = stack.habitsService.CompleteHabit(context.Background(), recipient.User.ID, habitID, habits.CompleteHabitRequest{
		Date: &today, Timezone: "UTC",
	})
	if err != nil {
		t.Fatalf("CompleteHabit: %v", err)
	}

	rangeConsistency, ok, err := stack.habitsService.ConsistencyForDateRange(
		context.Background(), habitID, rangeStart, rangeEnd, "UTC")
	if err != nil || !ok {
		t.Fatalf("ConsistencyForDateRange: ok=%v err=%v", ok, err)
	}

	detail, err = stack.challengesService.Get(context.Background(), creator.User.ID, ch.ID)
	if err != nil {
		t.Fatalf("get after complete: %v", err)
	}
	want := rangeConsistency / 100
	if detail.Progress != want {
		t.Fatalf("progress=%v want %v (range consistency %v / 100)", detail.Progress, want, rangeConsistency)
	}
	if detail.CompletionCount != 1 {
		t.Fatalf("completionCount=%d want 1", detail.CompletionCount)
	}

	// Dedupe: replaying the same local date must not double-count.
	if err := events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: recipient.User.ID, HabitID: habitID, Date: rangeStart, Consistency: 50, Timezone: "UTC",
	}); err != nil {
		t.Fatalf("replay emit: %v", err)
	}
	detail, err = stack.challengesService.Get(context.Background(), creator.User.ID, ch.ID)
	if err != nil {
		t.Fatalf("get after replay: %v", err)
	}
	if detail.CompletionCount != 1 {
		t.Fatalf("dedupe failed; count=%d", detail.CompletionCount)
	}
}

func TestClaim_SecondClaim_Returns400(t *testing.T) {
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim2a@example.com", "claim2a")
	recipient := registerUser(t, stack.authService, "claim2b@example.com", "claim2b")
	makeFriends(t, stack, creator.User.ID, recipient.User.ID)
	habitID := createHabit(t, stack, recipient.User.ID, "Run")

	ch, err := stack.challengesService.Create(context.Background(), creator.User.ID, challenges.CreateChallengeRequest{
		HabitID: habitID, RecipientID: recipient.User.ID,
		MilestoneType: challenges.MilestoneConsistencyTarget, TargetValue: 50,
		PeriodDays: 30, RewardDescription: "Coffee",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := events.Emit(context.Background(), stack.registry, events.HabitCompleted{
		UserID: recipient.User.ID, HabitID: habitID, Date: time.Now().UTC(), Consistency: 60,
	}); err != nil {
		t.Fatalf("emit: %v", err)
	}

	status, body := doRequest(t, stack.srv, testRequest{
		method: "PUT", path: "/challenges/" + ch.ID + "/claim",
		headers: bearerFor(t, stack.tokens, recipient.User.ID),
	})
	if status != 200 || body["status"] != "claimed" {
		t.Fatalf("first claim: %d %v", status, body)
	}

	status, body = doRequest(t, stack.srv, testRequest{
		method: "PUT", path: "/challenges/" + ch.ID + "/claim",
		headers: bearerFor(t, stack.tokens, recipient.User.ID),
	})
	if status != 400 || body["error"] != "Only completed challenges can be claimed" {
		t.Fatalf("second claim: %d %v", status, body)
	}
}
