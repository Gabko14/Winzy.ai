package scenarios

import (
	"fmt"
	"time"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// challengesAllMilestoneTypes covers challenge creation for all 5
// milestone types, listing with derived status, same-date replay dedupe
// (a same-day completion-kind update must not double-count progress), and
// the claim path (triggered via a totalCompletions target of 1, which the
// single completion we perform for the dedupe check also satisfies).
var challengesAllMilestoneTypes = runner.Scenario{
	Name: "challenges-all-milestone-types",
	Run: func(ctx *runner.Context) error {
		creator, err := registerUser(ctx, ctx.Native, "register-creator", "challengecreator")
		if err != nil {
			return err
		}
		recipient, err := registerUser(ctx, ctx.Native, "register-recipient", "challengerecipient")
		if err != nil {
			return err
		}
		if err := becomeFriends(ctx, creator, recipient, "establish-friendship"); err != nil {
			return err
		}

		// The Challenge unique constraint is filtered on (CreatorId,
		// RecipientId, HabitId) regardless of milestone type, so each of the
		// 5 challenges below needs its own habit — otherwise the 2nd..5th
		// creation 409s as a duplicate active challenge for that triple.
		habitNames := []string{"swim", "bike", "row", "hike", "paddle"}
		habits := map[string]string{}
		for _, name := range habitNames {
			hh, err := createHabit(ctx, ctx.Native, fmt.Sprintf("create-recipient-habit-%s", name), "challengerecipient", name, recipient.AccessToken, map[string]any{
				"name":      name,
				"frequency": "daily",
			})
			if err != nil {
				return err
			}
			habits[name] = hh.ID
		}
		totalCompletionsHabitID := habits["swim"]

		now := time.Now().UTC()
		customStart := now.Format(time.RFC3339)
		customEnd := now.AddDate(0, 0, 30).Format(time.RFC3339)

		type challengeSpec struct {
			step string
			body map[string]any
		}
		specs := []challengeSpec{
			{"create-consistency-target", map[string]any{
				"habitId": habits["bike"], "recipientId": recipient.ID, "milestoneType": "consistencyTarget",
				"targetValue": 10.0, "periodDays": 30, "rewardDescription": "Coffee together",
			}},
			{"create-days-in-period", map[string]any{
				"habitId": habits["row"], "recipientId": recipient.ID, "milestoneType": "daysInPeriod",
				"targetValue": 3.0, "periodDays": 7, "rewardDescription": "Play tennis",
			}},
			{"create-total-completions", map[string]any{
				"habitId": totalCompletionsHabitID, "recipientId": recipient.ID, "milestoneType": "totalCompletions",
				"targetValue": 1.0, "periodDays": 30, "rewardDescription": "Movie night",
			}},
			{"create-custom-date-range", map[string]any{
				"habitId": habits["hike"], "recipientId": recipient.ID, "milestoneType": "customDateRange",
				"targetValue": 10.0, "periodDays": 30, "rewardDescription": "Board game night",
				"customStartDate": customStart, "customEndDate": customEnd,
			}},
			{"create-improvement-milestone", map[string]any{
				"habitId": habits["paddle"], "recipientId": recipient.ID, "milestoneType": "improvementMilestone",
				"targetValue": 10.0, "periodDays": 30, "rewardDescription": "Picnic",
			}},
		}

		ids := map[string]string{}
		for _, spec := range specs {
			res, err := ctx.Call(ctx.Native, spec.step, httpclient.Request{
				Method: "POST",
				Path:   "/challenges",
				Bearer: creator.AccessToken,
				Body:   spec.body,
			}, 201)
			if err != nil {
				return err
			}
			m := asMap(res.JSON)
			ids[spec.step] = str(m, "id")
		}

		listRes, err := ctx.Call(ctx.Native, "list-challenges-recipient", httpclient.Request{
			Method: "GET",
			Path:   "/challenges",
			Bearer: recipient.AccessToken,
			Query:  q("page", "1", "pageSize", "20"),
		}, 200)
		if err != nil {
			return err
		}
		listBody := asMap(listRes.JSON)
		items, _ := listBody["items"].([]any)
		if len(items) < 5 {
			ctx.Fail("list-challenges-recipient", httpclient.Request{}, listRes,
				fmt.Sprintf("expected at least 5 challenges in the recipient's list, got %d", len(items)))
		}

		totalCompletionsID := ids["create-total-completions"]

		beforeRes, err := ctx.Call(ctx.Native, "get-total-completions-before-completion", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/challenges/%s", totalCompletionsID),
			Bearer: recipient.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		before := asMap(beforeRes.JSON)
		if flt(before, "completionCount") != 0 {
			ctx.Fail("get-total-completions-before-completion", httpclient.Request{}, beforeRes, "expected completionCount 0 before any habit completion")
		}

		today := todayIn("UTC")
		_, err = ctx.Call(ctx.Native, "recipient-completes-habit", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/habits/%s/complete", totalCompletionsHabitID),
			Bearer: recipient.AccessToken,
			Body:   map[string]any{"date": today, "timezone": "UTC"},
		}, 201)
		if err != nil {
			return err
		}

		// habit.completed is processed by an async NATS consumer, not
		// synchronously within the POST /complete request — wait for the
		// challenge's progress to actually land before asserting on it.
		waitUntil(ctx.Native, fmt.Sprintf("/challenges/%s", totalCompletionsID), recipient.AccessToken, 5*time.Second,
			func(m map[string]any) bool { return flt(m, "completionCount") >= 1 })

		afterRes, err := ctx.Call(ctx.Native, "get-total-completions-after-completion", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/challenges/%s", totalCompletionsID),
			Bearer: recipient.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		after := asMap(afterRes.JSON)
		if flt(after, "completionCount") != 1 {
			ctx.Fail("get-total-completions-after-completion", httpclient.Request{}, afterRes,
				fmt.Sprintf("expected completionCount 1 after one completion, got %.0f", flt(after, "completionCount")))
		}
		if str(after, "status") != "completed" {
			ctx.Fail("get-total-completions-after-completion", httpclient.Request{}, afterRes,
				fmt.Sprintf("expected status completed once totalCompletions target of 1 is met, got %q", str(after, "status")))
		}

		// Same-date replay dedupe: updating the completion KIND for the same
		// date must not be treated as a second completion event.
		_, err = ctx.Call(ctx.Native, "update-same-date-completion-kind", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/habits/%s/completions/%s", totalCompletionsHabitID, today),
			Bearer: recipient.AccessToken,
			Body:   map[string]any{"completionKind": "full"},
		}, 200)
		if err != nil {
			return err
		}

		// No positive condition to poll for here (we're checking that a
		// second completion event did NOT land) — give any async processing
		// a fixed window to (mis)fire before reading the authoritative state.
		settle(800 * time.Millisecond)

		dedupeRes, err := ctx.Call(ctx.Native, "get-total-completions-after-same-date-update", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/challenges/%s", totalCompletionsID),
			Bearer: recipient.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		dedupe := asMap(dedupeRes.JSON)
		if flt(dedupe, "completionCount") != 1 {
			ctx.Fail("get-total-completions-after-same-date-update", httpclient.Request{}, dedupeRes,
				fmt.Sprintf("expected completionCount to remain 1 (dedupe), got %.0f", flt(dedupe, "completionCount")))
		}

		_, err = ctx.Call(ctx.Native, "claim-completed-challenge", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/challenges/%s/claim", totalCompletionsID),
			Bearer: recipient.AccessToken,
		}, 200)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "creator-deletes-improvement-challenge", httpclient.Request{
			Method: "DELETE",
			Path:   fmt.Sprintf("/challenges/%s", ids["create-improvement-milestone"]),
			Bearer: creator.AccessToken,
		}, 204)
		return err
	},
}

func init() {
	registerAll(challengesAllMilestoneTypes)
}
