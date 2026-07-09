package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// activityFeedPagination covers cursor round-trip: page 1's nextCursor,
// fed back in, must yield a disjoint page 2 with no item overlap, plus the
// invalid-cursor error shape.
var activityFeedPagination = runner.Scenario{
	Name: "activity-feed-pagination",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "feeduser")
		if err != nil {
			return err
		}

		// Generate several feed-worthy events (one per habit created).
		names := []string{"Read", "Write", "Run", "Swim", "Cycle"}
		for i, name := range names {
			_, err := ctx.Call(ctx.Native, fmt.Sprintf("create-habit-%d", i+1), httpclient.Request{
				Method: "POST",
				Path:   "/habits",
				Bearer: u.AccessToken,
				Body: map[string]any{
					"name":      name,
					"frequency": "daily",
				},
			}, 201)
			if err != nil {
				return err
			}
		}

		page1Res, err := ctx.Call(ctx.Native, "feed-page-1", httpclient.Request{
			Method: "GET",
			Path:   "/activity/feed",
			Bearer: u.AccessToken,
			Query:  q("limit", "2"),
		}, 200)
		if err != nil {
			return err
		}
		page1 := asMap(page1Res.JSON)
		page1Items, _ := page1["items"].([]any)
		nextCursor := str(page1, "nextCursor")
		if nextCursor == "" {
			ctx.Fail("feed-page-1", httpclient.Request{}, page1Res, "expected a nextCursor with 5 events and a page size of 2")
		}

		page2Res, err := ctx.Call(ctx.Native, "feed-page-2-via-cursor", httpclient.Request{
			Method: "GET",
			Path:   "/activity/feed",
			Bearer: u.AccessToken,
			Query:  q("limit", "2", "cursor", nextCursor),
		}, 200)
		if err != nil {
			return err
		}
		page2 := asMap(page2Res.JSON)
		page2Items, _ := page2["items"].([]any)

		page1IDs := map[string]bool{}
		for _, it := range page1Items {
			page1IDs[str(asMap(it), "id")] = true
		}
		for _, it := range page2Items {
			if page1IDs[str(asMap(it), "id")] {
				ctx.Fail("feed-page-2-via-cursor", httpclient.Request{}, page2Res, "page 2 must not overlap with page 1 (cursor round-trip)")
				break
			}
		}

		_, err = ctx.Call(ctx.Native, "feed-invalid-cursor", httpclient.Request{
			Method: "GET",
			Path:   "/activity/feed",
			Bearer: u.AccessToken,
			Query:  q("cursor", "not-a-real-cursor"),
		}, 400)
		return err
	},
}

func init() {
	registerAll(activityFeedPagination)
}
