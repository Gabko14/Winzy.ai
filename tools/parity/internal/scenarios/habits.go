package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// habitsCRUDArchive covers create/read/update/list/archive for a Daily
// habit, plus a Weekly habit to exercise the customDays path.
var habitsCRUDArchive = runner.Scenario{
	Name: "habits-crud-archive",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "habitowner")
		if err != nil {
			return err
		}

		h, err := createHabit(ctx, ctx.Native, "create-daily", "habitowner", "reading", u.AccessToken, map[string]any{
			"name":      "Read",
			"icon":      "book",
			"color":     "#336699",
			"frequency": "daily",
		})
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "create-weekly", httpclient.Request{
			Method: "POST",
			Path:   "/habits",
			Bearer: u.AccessToken,
			Body: map[string]any{
				"name":       "Gym",
				"frequency":  "weekly",
				"customDays": []string{"monday", "wednesday", "friday"},
			},
		}, 201)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "get-habit", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/habits/%s", h.ID),
			Bearer: u.AccessToken,
		}, 200)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "list-habits", httpclient.Request{
			Method: "GET",
			Path:   "/habits",
			Bearer: u.AccessToken,
		}, 200)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "update-habit", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/habits/%s", h.ID),
			Bearer: u.AccessToken,
			Body: map[string]any{
				"name":               "Read Daily",
				"minimumDescription": "Read at least one page",
			},
		}, 200)
		if err != nil {
			return err
		}

		archiveRes, err := ctx.Call(ctx.Native, "archive-habit", httpclient.Request{
			Method: "DELETE",
			Path:   fmt.Sprintf("/habits/%s", h.ID),
			Bearer: u.AccessToken,
		}, 204)
		if err != nil {
			return err
		}
		_ = archiveRes

		// GetHabit filters ArchivedAt == null (services/habit-service/src/Endpoints/HabitEndpoints.cs),
		// so an archived habit is no longer individually reachable by id — this
		// 404 (not a 200 with archivedAt set) IS the soft-archive contract.
		_, err = ctx.Call(ctx.Native, "get-habit-after-archive-is-404", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/habits/%s", h.ID),
			Bearer: u.AccessToken,
		}, 404)
		if err != nil {
			return err
		}

		listAfterArchiveRes, err := ctx.Call(ctx.Native, "list-habits-after-archive-excludes-it", httpclient.Request{
			Method: "GET",
			Path:   "/habits",
			Bearer: u.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		if arr, ok := listAfterArchiveRes.JSON.([]any); ok {
			for _, it := range arr {
				if str(asMap(it), "id") == h.ID {
					ctx.Fail("list-habits-after-archive-excludes-it", httpclient.Request{}, listAfterArchiveRes,
						"expected the archived habit to be excluded from the active habits list")
				}
			}
		}
		return nil
	},
}

func init() {
	registerAll(habitsCRUDArchive)
}
