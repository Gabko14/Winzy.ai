package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// visibilityChangesAndFeed covers PUT/GET /social/visibility and the
// documented narrowing/restoring effect on a friend's activity feed:
// narrowing a habit's visibility soft-deletes its feed entries for
// friends who can no longer see it; widening back restores them.
var visibilityChangesAndFeed = runner.Scenario{
	Name: "visibility-changes-and-feed",
	Run: func(ctx *runner.Context) error {
		owner, err := registerUser(ctx, ctx.Native, "register-owner", "visowner")
		if err != nil {
			return err
		}
		friend, err := registerUser(ctx, ctx.Native, "register-friend", "visfriend")
		if err != nil {
			return err
		}
		if err := becomeFriends(ctx, owner, friend, "establish-friendship"); err != nil {
			return err
		}

		h, err := createHabit(ctx, ctx.Native, "create-habit-default-private", "visowner", "journal", owner.AccessToken, map[string]any{
			"name":      "Journal",
			"frequency": "daily",
		})
		if err != nil {
			return err
		}

		visRes, err := ctx.Call(ctx.Native, "get-visibility-default", httpclient.Request{
			Method: "GET",
			Path:   "/social/visibility",
			Bearer: owner.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		_ = visRes

		_, err = ctx.Call(ctx.Native, "widen-visibility-to-friends", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/social/visibility/%s", h.ID),
			Bearer: owner.AccessToken,
			Body:   map[string]any{"visibility": "friends"},
		}, 200)
		if err != nil {
			return err
		}

		widenedFeedRes, err := ctx.Call(ctx.Native, "friend-feed-after-widen", httpclient.Request{
			Method: "GET",
			Path:   "/activity/feed",
			Bearer: friend.AccessToken,
			Query:  q("limit", "50"),
		}, 200)
		if err != nil {
			return err
		}
		if !feedContainsHabit(widenedFeedRes.JSON, h.ID) {
			ctx.Fail("friend-feed-after-widen", httpclient.Request{}, widenedFeedRes,
				"expected the friend's feed to include an entry referencing the now-friends-visible habit")
		}

		_, err = ctx.Call(ctx.Native, "narrow-visibility-to-private", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/social/visibility/%s", h.ID),
			Bearer: owner.AccessToken,
			Body:   map[string]any{"visibility": "private"},
		}, 200)
		if err != nil {
			return err
		}

		narrowedFeedRes, err := ctx.Call(ctx.Native, "friend-feed-after-narrow", httpclient.Request{
			Method: "GET",
			Path:   "/activity/feed",
			Bearer: friend.AccessToken,
			Query:  q("limit", "50"),
		}, 200)
		if err != nil {
			return err
		}
		if feedContainsHabit(narrowedFeedRes.JSON, h.ID) {
			ctx.Fail("friend-feed-after-narrow", httpclient.Request{}, narrowedFeedRes,
				"expected the friend's feed entry for the now-private habit to be soft-deleted (narrowing)")
		}

		_, err = ctx.Call(ctx.Native, "re-widen-visibility-to-public", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/social/visibility/%s", h.ID),
			Bearer: owner.AccessToken,
			Body:   map[string]any{"visibility": "public"},
		}, 200)
		if err != nil {
			return err
		}

		restoredFeedRes, err := ctx.Call(ctx.Native, "friend-feed-after-restore", httpclient.Request{
			Method: "GET",
			Path:   "/activity/feed",
			Bearer: friend.AccessToken,
			Query:  q("limit", "50"),
		}, 200)
		if err != nil {
			return err
		}
		if !feedContainsHabit(restoredFeedRes.JSON, h.ID) {
			ctx.Fail("friend-feed-after-restore", httpclient.Request{}, restoredFeedRes,
				"expected the friend's feed entry to be restored after widening visibility back")
		}
		return nil
	},
}

func feedContainsHabit(body any, habitID string) bool {
	m := asMap(body)
	items, _ := m["items"].([]any)
	for _, it := range items {
		data := asMap(asMap(it)["data"])
		if str(data, "habitId") == habitID {
			return true
		}
	}
	return false
}

func init() {
	registerAll(visibilityChangesAndFeed)
}
