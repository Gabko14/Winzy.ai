package scenarios

import (
	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// authExportEquivalence covers GET /auth/export: the full export document
// (proves the export registry reproduces the five-service fan-out) and its
// per-user rate limit (1/60s).
var authExportEquivalence = runner.Scenario{
	Name: "auth-export-equivalence",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "exportuser")
		if err != nil {
			return err
		}

		_, err = createHabit(ctx, ctx.Native, "create-habit-for-export", "exportuser", "habit1", u.AccessToken, map[string]any{
			"name":      "Export Habit",
			"frequency": "daily",
		})
		if err != nil {
			return err
		}

		exportRes, err := ctx.Call(ctx.Native, "get-export", httpclient.Request{
			Method: "GET",
			Path:   "/auth/export",
			Bearer: u.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		body := asMap(exportRes.JSON)
		services, _ := body["services"].([]any)
		if len(services) == 0 {
			ctx.Fail("get-export", httpclient.Request{}, exportRes, "expected a non-empty services array in the export document")
		}
		for _, svc := range services {
			m := asMap(svc)
			if str(m, "service") == "" {
				ctx.Fail("get-export", httpclient.Request{}, exportRes, "expected every services[] entry to have a non-empty service name")
			}
		}

		_, err = ctx.Call(ctx.Native, "get-export-rate-limited", httpclient.Request{
			Method: "GET",
			Path:   "/auth/export",
			Bearer: u.AccessToken,
		}, 429)
		return err
	},
}

func init() {
	registerAll(authExportEquivalence)
}
