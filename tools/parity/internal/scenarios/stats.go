package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// statsAcrossTimezones covers GET /habits/{id}/stats under several
// X-Timezone values — including a DST-observing zone and a date-line zone,
// per the danger-zone list — plus the missing/invalid header error cases.
var statsAcrossTimezones = runner.Scenario{
	Name: "stats-across-timezones",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "statsuser")
		if err != nil {
			return err
		}

		h, err := createHabit(ctx, ctx.Native, "create-habit", "statsuser", "walk", u.AccessToken, map[string]any{
			"name":      "Walk",
			"frequency": "daily",
		})
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "complete-today-utc", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/habits/%s/complete", h.ID),
			Bearer: u.AccessToken,
			Body: map[string]any{
				"date":     todayIn("UTC"),
				"timezone": "UTC",
			},
		}, 201)
		if err != nil {
			return err
		}

		timezones := []string{
			"UTC",
			"America/New_York",
			"Europe/Berlin",      // DST-observing
			"Pacific/Kiritimati", // UTC+14, date-line
			"Pacific/Niue",       // UTC-11
		}
		for _, tz := range timezones {
			step := "get-stats-tz-" + tz
			res, err := ctx.Call(ctx.Native, step, httpclient.Request{
				Method:  "GET",
				Path:    fmt.Sprintf("/habits/%s/stats", h.ID),
				Bearer:  u.AccessToken,
				Headers: map[string]string{"X-Timezone": tz},
			}, 200)
			if err != nil {
				return err
			}
			m := asMap(res.JSON)
			if _, ok := m["flameLevel"]; !ok {
				ctx.Fail(step, httpclient.Request{}, res, "expected flameLevel field in stats response")
			}
			if _, ok := m["consistency"]; !ok {
				ctx.Fail(step, httpclient.Request{}, res, "expected consistency field in stats response")
			}
		}

		missingRes, err := ctx.Call(ctx.Native, "stats-missing-timezone-header", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/habits/%s/stats", h.ID),
			Bearer: u.AccessToken,
		}, 400)
		if err != nil {
			return err
		}
		missing := asMap(missingRes.JSON)
		if _, ok := missing["error"]; !ok {
			ctx.Fail("stats-missing-timezone-header", httpclient.Request{}, missingRes, `expected {"error": "..."} on missing X-Timezone`)
		}

		invalidRes, err := ctx.Call(ctx.Native, "stats-invalid-timezone-header", httpclient.Request{
			Method:  "GET",
			Path:    fmt.Sprintf("/habits/%s/stats", h.ID),
			Bearer:  u.AccessToken,
			Headers: map[string]string{"X-Timezone": "Not/ARealZone"},
		}, 400)
		if err != nil {
			return err
		}
		invalid := asMap(invalidRes.JSON)
		if _, ok := invalid["error"]; !ok {
			ctx.Fail("stats-invalid-timezone-header", httpclient.Request{}, invalidRes, `expected {"error": "..."} on invalid X-Timezone`)
		}
		return nil
	},
}

func init() {
	registerAll(statsAcrossTimezones)
}
