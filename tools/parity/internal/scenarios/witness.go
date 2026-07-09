package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// witnessLinks covers create/get-by-token/rotate (old token 404, new token
// 200)/revoke (404 afterwards) — including that a revoked or unknown token
// return the identical 404 shape (timing-safe, no distinguishing signal).
var witnessLinks = runner.Scenario{
	Name: "witness-links",
	Run: func(ctx *runner.Context) error {
		owner, err := registerUser(ctx, ctx.Native, "register", "witnessowner")
		if err != nil {
			return err
		}
		h, err := createHabit(ctx, ctx.Native, "create-habit", "witnessowner", "yoga", owner.AccessToken, map[string]any{
			"name":      "Yoga",
			"frequency": "daily",
		})
		if err != nil {
			return err
		}

		createRes, err := ctx.Call(ctx.Native, "create-witness-link", httpclient.Request{
			Method: "POST",
			Path:   "/social/witness-links",
			Bearer: owner.AccessToken,
			Body: map[string]any{
				"label":    "Parity witness",
				"habitIds": []string{h.ID},
			},
		}, 201)
		if err != nil {
			return err
		}
		created := asMap(createRes.JSON)
		linkID := str(created, "id")
		firstToken := str(created, "token")

		_, err = ctx.Call(ctx.Native, "get-via-token", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/social/witness/%s", firstToken),
		}, 200)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "get-unknown-token-404", httpclient.Request{
			Method: "GET",
			Path:   "/social/witness/not-a-real-token-at-all",
		}, 404)
		if err != nil {
			return err
		}

		rotateRes, err := ctx.Call(ctx.Native, "rotate-token", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/social/witness-links/%s/rotate", linkID),
			Bearer: owner.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		rotated := asMap(rotateRes.JSON)
		secondToken := str(rotated, "token")

		_, err = ctx.Call(ctx.Native, "old-token-404-after-rotate", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/social/witness/%s", firstToken),
		}, 404)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "new-token-works-after-rotate", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/social/witness/%s", secondToken),
		}, 200)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "revoke-witness-link", httpclient.Request{
			Method: "DELETE",
			Path:   fmt.Sprintf("/social/witness-links/%s", linkID),
			Bearer: owner.AccessToken,
		}, 204)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "revoked-token-404", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/social/witness/%s", secondToken),
		}, 404)
		return err
	},
}

func init() {
	registerAll(witnessLinks)
}
