package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// promisesLifecycle covers promise create/get/duplicate-conflict/patch
// visibility/cancel, and the PrivateNote exclusion from the public flame
// page. NOTE: lazy Kept/EndedBelow resolution (computed the first time a
// promise is read after its endDate has passed) cannot be exercised here —
// endDate must be in the future at creation time, and resolution only
// happens lazily on a later read once real time has elapsed past it. A
// short-lived scripted run can't fast-forward the clock; see the
// dispatch report's open questions.
var promisesLifecycle = runner.Scenario{
	Name: "promises-lifecycle",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "promiser")
		if err != nil {
			return err
		}

		h, err := createHabit(ctx, ctx.Native, "create-habit", "promiser", "write", u.AccessToken, map[string]any{
			"name":      "Write",
			"frequency": "daily",
		})
		if err != nil {
			return err
		}

		endDate := dateOffset(todayIn("UTC"), 30)

		_, err = ctx.Call(ctx.Native, "create-promise", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/habits/%s/promise", h.ID),
			Bearer: u.AccessToken,
			Body: map[string]any{
				"targetConsistency": 50,
				"endDate":           endDate,
				"privateNote":       "Only I should ever see this note",
				"isPublicOnFlame":   false,
			},
		}, 201)
		if err != nil {
			return err
		}

		getRes, err := ctx.Call(ctx.Native, "get-active-promise", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/habits/%s/promise", h.ID),
			Bearer: u.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		got := asMap(getRes.JSON)
		active := asMap(got["active"])
		if str(active, "status") != "active" {
			ctx.Fail("get-active-promise", httpclient.Request{}, getRes, fmt.Sprintf("expected status active, got %q", str(active, "status")))
		}
		if str(active, "privateNote") == "" {
			ctx.Fail("get-active-promise", httpclient.Request{}, getRes, "expected privateNote to be visible to the owner")
		}

		dupRes, err := ctx.Call(ctx.Native, "create-duplicate-promise-conflict", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/habits/%s/promise", h.ID),
			Bearer: u.AccessToken,
			Body: map[string]any{
				"targetConsistency": 80,
				"endDate":           endDate,
			},
		}, 409)
		if err != nil {
			return err
		}
		dup := asMap(dupRes.JSON)
		if _, ok := dup["error"]; !ok {
			ctx.Fail("create-duplicate-promise-conflict", httpclient.Request{}, dupRes, `expected {"error": "..."} on 409`)
		}

		_, err = ctx.Call(ctx.Native, "patch-promise-visibility-public", httpclient.Request{
			Method: "PATCH",
			Path:   fmt.Sprintf("/habits/%s/promise/visibility", h.ID),
			Bearer: u.AccessToken,
			Body:   map[string]any{"isPublicOnFlame": true},
		}, 200)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "set-habit-visibility-public", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/social/visibility/%s", h.ID),
			Bearer: u.AccessToken,
			Body:   map[string]any{"visibility": "public"},
		}, 200)
		if err != nil {
			return err
		}

		publicRes, err := ctx.Call(ctx.Native, "public-page-excludes-private-note", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/habits/public/%s", u.Username),
		}, 200)
		if err != nil {
			return err
		}
		pub := asMap(publicRes.JSON)
		pubHabits, _ := pub["habits"].([]any)
		for _, hh := range pubHabits {
			m := asMap(hh)
			if str(m, "id") != h.ID {
				continue
			}
			promise := asMap(m["promise"])
			if _, leaked := promise["privateNote"]; leaked {
				ctx.Fail("public-page-excludes-private-note", httpclient.Request{}, publicRes,
					"public flame page's promise object must never include privateNote")
			}
			if _, ok := promise["statement"]; !ok {
				ctx.Fail("public-page-excludes-private-note", httpclient.Request{}, publicRes,
					"expected the public promise object to include a statement field")
			}
		}

		_, err = ctx.Call(ctx.Native, "cancel-promise", httpclient.Request{
			Method: "DELETE",
			Path:   fmt.Sprintf("/habits/%s/promise", h.ID),
			Bearer: u.AccessToken,
		}, 204)
		if err != nil {
			return err
		}

		afterCancelRes, err := ctx.Call(ctx.Native, "get-promise-after-cancel", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/habits/%s/promise", h.ID),
			Query:  q("history", "true"),
			Bearer: u.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		after := asMap(afterCancelRes.JSON)
		if after["active"] != nil {
			ctx.Fail("get-promise-after-cancel", httpclient.Request{}, afterCancelRes, "expected active to be null after cancellation")
		}
		return nil
	},
}

func init() {
	registerAll(promisesLifecycle)
}
