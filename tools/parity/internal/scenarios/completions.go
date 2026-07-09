package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// completionsBackfillAndKinds covers: backfilling a completion for a date
// before the habit's creation instant, same-day repeat (409 then update via
// PUT), minimum-kind completion with and without minimumDescription set,
// and delete-by-date.
var completionsBackfillAndKinds = runner.Scenario{
	Name: "completions-backfill-and-kinds",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "completer")
		if err != nil {
			return err
		}

		h, err := createHabit(ctx, ctx.Native, "create-habit-with-minimum", "completer", "meditate", u.AccessToken, map[string]any{
			"name":               "Meditate",
			"frequency":          "daily",
			"minimumDescription": "At least 2 minutes",
		})
		if err != nil {
			return err
		}

		today := todayIn("UTC")
		backfillDate := dateOffset(today, -5)

		backfillRes, err := ctx.Call(ctx.Native, "backfill-completion-before-creation", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/habits/%s/complete", h.ID),
			Bearer: u.AccessToken,
			Body: map[string]any{
				"date":     backfillDate,
				"timezone": "UTC",
			},
		}, 201)
		if err != nil {
			return err
		}
		bf := asMap(backfillRes.JSON)
		if str(bf, "localDate") != backfillDate {
			ctx.Fail("backfill-completion-before-creation", httpclient.Request{}, backfillRes,
				fmt.Sprintf("expected localDate %s, got %s", backfillDate, str(bf, "localDate")))
		}

		_, err = ctx.Call(ctx.Native, "complete-today-first-time", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/habits/%s/complete", h.ID),
			Bearer: u.AccessToken,
			Body: map[string]any{
				"date":     today,
				"timezone": "UTC",
			},
		}, 201)
		if err != nil {
			return err
		}

		dupRes, err := ctx.Call(ctx.Native, "complete-today-duplicate-conflict", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/habits/%s/complete", h.ID),
			Bearer: u.AccessToken,
			Body: map[string]any{
				"date":     today,
				"timezone": "UTC",
			},
		}, 409)
		if err != nil {
			return err
		}
		dup := asMap(dupRes.JSON)
		if _, ok := dup["error"]; !ok {
			ctx.Fail("complete-today-duplicate-conflict", httpclient.Request{}, dupRes, `expected {"error": "..."} on 409`)
		}

		_, err = ctx.Call(ctx.Native, "update-completion-kind-to-minimum", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/habits/%s/completions/%s", h.ID, today),
			Bearer: u.AccessToken,
			Body:   map[string]any{"completionKind": "minimum"},
		}, 200)
		if err != nil {
			return err
		}

		noMinH, err := createHabit(ctx, ctx.Native, "create-habit-without-minimum", "completer", "run", u.AccessToken, map[string]any{
			"name":      "Run",
			"frequency": "daily",
		})
		if err != nil {
			return err
		}

		minWithoutDescRes, err := ctx.Call(ctx.Native, "minimum-kind-without-minimum-description-rejected", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/habits/%s/complete", noMinH.ID),
			Bearer: u.AccessToken,
			Body: map[string]any{
				"date":           today,
				"timezone":       "UTC",
				"completionKind": "minimum",
			},
		}, 400)
		if err != nil {
			return err
		}
		mw := asMap(minWithoutDescRes.JSON)
		if _, ok := mw["error"]; !ok {
			ctx.Fail("minimum-kind-without-minimum-description-rejected", httpclient.Request{}, minWithoutDescRes,
				`expected {"error": "..."} on 400`)
		}

		_, err = ctx.Call(ctx.Native, "delete-completion-by-date", httpclient.Request{
			Method: "DELETE",
			Path:   fmt.Sprintf("/habits/%s/completions/%s", h.ID, backfillDate),
			Bearer: u.AccessToken,
		}, 204)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "get-completions-for-date", httpclient.Request{
			Method: "GET",
			Path:   "/habits/completions",
			Query:  q("date", today),
			Bearer: u.AccessToken,
		}, 200)
		return err
	},
}

func init() {
	registerAll(completionsBackfillAndKinds)
}
