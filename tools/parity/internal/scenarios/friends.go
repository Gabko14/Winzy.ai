package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// friendsLifecycle covers request/accept, request/decline, listing (which
// must show the reverse row created on accept), and remove (which deletes
// both directions).
var friendsLifecycle = runner.Scenario{
	Name: "friends-lifecycle",
	Run: func(ctx *runner.Context) error {
		a, err := registerUser(ctx, ctx.Native, "register-a", "friendA")
		if err != nil {
			return err
		}
		b, err := registerUser(ctx, ctx.Native, "register-b", "friendB")
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "a-requests-b", httpclient.Request{
			Method: "POST",
			Path:   "/social/friends/request",
			Bearer: a.AccessToken,
			Body:   map[string]any{"friendId": b.ID},
		}, 200, 201)
		if err != nil {
			return err
		}

		bIncomingRes, err := ctx.Call(ctx.Native, "b-lists-incoming-requests", httpclient.Request{
			Method: "GET",
			Path:   "/social/friends/requests",
			Bearer: b.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		bIncoming := asMap(bIncomingRes.JSON)
		incoming, _ := bIncoming["incoming"].([]any)
		if len(incoming) == 0 {
			ctx.Fail("b-lists-incoming-requests", httpclient.Request{}, bIncomingRes, "expected at least one incoming friend request for B")
			return nil
		}
		requestID := str(asMap(incoming[0]), "id")
		ctx.IDs.Register("friendrequest:a-to-b", requestID)

		_, err = ctx.Call(ctx.Native, "b-accepts-a", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/social/friends/request/%s/accept", requestID),
			Bearer: b.AccessToken,
		}, 200)
		if err != nil {
			return err
		}

		aFriendsRes, err := ctx.Call(ctx.Native, "a-lists-friends", httpclient.Request{
			Method: "GET",
			Path:   "/social/friends",
			Bearer: a.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		if !friendsListContains(aFriendsRes.JSON, b.ID) {
			ctx.Fail("a-lists-friends", httpclient.Request{}, aFriendsRes, "expected A's friends list to contain B after accept")
		}

		bFriendsRes, err := ctx.Call(ctx.Native, "b-lists-friends-reverse-row", httpclient.Request{
			Method: "GET",
			Path:   "/social/friends",
			Bearer: b.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		if !friendsListContains(bFriendsRes.JSON, a.ID) {
			ctx.Fail("b-lists-friends-reverse-row", httpclient.Request{}, bFriendsRes, "expected B's friends list to contain A (reverse row created on accept)")
		}

		// Second pair: decline path.
		c, err := registerUser(ctx, ctx.Native, "register-c", "friendC")
		if err != nil {
			return err
		}
		d, err := registerUser(ctx, ctx.Native, "register-d", "friendD")
		if err != nil {
			return err
		}
		_, err = ctx.Call(ctx.Native, "c-requests-d", httpclient.Request{
			Method: "POST",
			Path:   "/social/friends/request",
			Bearer: c.AccessToken,
			Body:   map[string]any{"friendId": d.ID},
		}, 200, 201)
		if err != nil {
			return err
		}
		dIncomingRes, err := ctx.Call(ctx.Native, "d-lists-incoming-requests", httpclient.Request{
			Method: "GET",
			Path:   "/social/friends/requests",
			Bearer: d.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		dIncoming := asMap(dIncomingRes.JSON)
		incoming2, _ := dIncoming["incoming"].([]any)
		if len(incoming2) == 0 {
			ctx.Fail("d-lists-incoming-requests", httpclient.Request{}, dIncomingRes, "expected at least one incoming friend request for D")
			return nil
		}
		requestID2 := str(asMap(incoming2[0]), "id")

		_, err = ctx.Call(ctx.Native, "d-declines-c", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/social/friends/request/%s/decline", requestID2),
			Bearer: d.AccessToken,
		}, 204)
		if err != nil {
			return err
		}

		countRes, err := ctx.Call(ctx.Native, "d-requests-count-after-decline", httpclient.Request{
			Method: "GET",
			Path:   "/social/friends/requests/count",
			Bearer: d.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		countBody := asMap(countRes.JSON)
		if flt(countBody, "count") != 0 {
			ctx.Fail("d-requests-count-after-decline", httpclient.Request{}, countRes, "expected requests count to be 0 after decline")
		}

		// Remove: A removes B, both directions must disappear.
		_, err = ctx.Call(ctx.Native, "a-removes-b", httpclient.Request{
			Method: "DELETE",
			Path:   fmt.Sprintf("/social/friends/%s", b.ID),
			Bearer: a.AccessToken,
		}, 204)
		if err != nil {
			return err
		}

		aFriendsAfterRes, err := ctx.Call(ctx.Native, "a-lists-friends-after-remove", httpclient.Request{
			Method: "GET",
			Path:   "/social/friends",
			Bearer: a.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		if friendsListContains(aFriendsAfterRes.JSON, b.ID) {
			ctx.Fail("a-lists-friends-after-remove", httpclient.Request{}, aFriendsAfterRes, "expected B to be gone from A's friends list after remove")
		}

		bFriendsAfterRes, err := ctx.Call(ctx.Native, "b-lists-friends-after-remove", httpclient.Request{
			Method: "GET",
			Path:   "/social/friends",
			Bearer: b.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		if friendsListContains(bFriendsAfterRes.JSON, a.ID) {
			ctx.Fail("b-lists-friends-after-remove", httpclient.Request{}, bFriendsAfterRes, "expected A to be gone from B's friends list after remove (both directions deleted)")
		}
		return nil
	},
}

func friendsListContains(body any, friendID string) bool {
	m := asMap(body)
	items, _ := m["items"].([]any)
	for _, it := range items {
		if str(asMap(it), "friendId") == friendID {
			return true
		}
	}
	return false
}

func init() {
	registerAll(friendsLifecycle)
}
