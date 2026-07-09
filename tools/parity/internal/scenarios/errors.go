package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// errorShapesAnd401 is a dedicated pass over the danger-zone error
// behaviors not already exercised inline by other scenarios: missing
// Authorization, a garbage bearer token, and a non-creator attempting a
// creator-only action.
var errorShapesAnd401 = runner.Scenario{
	Name: "error-shapes-and-401",
	Run: func(ctx *runner.Context) error {
		_, err := ctx.Call(ctx.Native, "no-authorization-header", httpclient.Request{
			Method: "GET",
			Path:   "/habits",
		}, 401)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "garbage-bearer-token", httpclient.Request{
			Method: "GET",
			Path:   "/habits",
			Bearer: "not-a-real-jwt-at-all",
		}, 401)
		if err != nil {
			return err
		}

		creator, err := registerUser(ctx, ctx.Native, "register-creator", "errcreator")
		if err != nil {
			return err
		}
		recipient, err := registerUser(ctx, ctx.Native, "register-recipient", "errrecipient")
		if err != nil {
			return err
		}
		if err := becomeFriends(ctx, creator, recipient, "establish-friendship"); err != nil {
			return err
		}
		h, err := createHabit(ctx, ctx.Native, "create-recipient-habit", "errrecipient", "habit", recipient.AccessToken, map[string]any{
			"name":      "Errors Habit",
			"frequency": "daily",
		})
		if err != nil {
			return err
		}
		challengeRes, err := ctx.Call(ctx.Native, "creator-creates-challenge", httpclient.Request{
			Method: "POST",
			Path:   "/challenges",
			Bearer: creator.AccessToken,
			Body: map[string]any{
				"habitId": h.ID, "recipientId": recipient.ID, "milestoneType": "consistencyTarget",
				"targetValue": 10.0, "periodDays": 30, "rewardDescription": "Coffee",
			},
		}, 201)
		if err != nil {
			return err
		}
		challengeID := str(asMap(challengeRes.JSON), "id")

		// Non-creator (the recipient) must not be able to delete the
		// challenge. We don't pin an exact status code here (not documented
		// precisely), only that it must not succeed.
		nonCreatorDeleteRes, err := ctx.Call(ctx.Native, "non-creator-delete-challenge-rejected", httpclient.Request{
			Method: "DELETE",
			Path:   fmt.Sprintf("/challenges/%s", challengeID),
			Bearer: recipient.AccessToken,
		})
		if err != nil {
			return err
		}
		if nonCreatorDeleteRes.StatusCode >= 200 && nonCreatorDeleteRes.StatusCode < 300 {
			ctx.Fail("non-creator-delete-challenge-rejected", httpclient.Request{}, nonCreatorDeleteRes,
				fmt.Sprintf("expected a non-creator's delete to be rejected, got success status %d", nonCreatorDeleteRes.StatusCode))
		}
		return nil
	},
}

func init() {
	registerAll(errorShapesAnd401)
}
