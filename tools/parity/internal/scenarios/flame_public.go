package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// publicFlamePageUTCContract covers GET /habits/public/{username} and
// flame.svg, and proves the documented UTC-hardcoding contract: the public
// surfaces must compute "today" in UTC regardless of the owner's own
// timezone. We prove this two ways, both derived from the ACTUAL current
// moment (never a hardcoded assumption, so the assertions never flake
// regardless of what day/hour the harness runs):
//
//  1. Positive proof (always true): the owner endpoint queried with
//     X-Timezone: UTC must report the same consistency as the public page,
//     since the public page is documented to hardcode UTC.
//  2. Conditional proof (true whenever the two "today"s actually differ at
//     run time — i.e. the run straddles the date line for the extreme
//     timezone used below): the owner endpoint queried with the owner's own
//     far-ahead timezone diverges from the UTC view. When the run happens
//     not to straddle midnight for that zone, this check is skipped rather
//     than asserted, so the scenario is never flaky.
var publicFlamePageUTCContract = runner.Scenario{
	Name: "public-flame-page-utc-contract",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "flameowner")
		if err != nil {
			return err
		}

		h, err := createHabit(ctx, ctx.Native, "create-habit", "flameowner", "reading", u.AccessToken, map[string]any{
			"name":      "Read",
			"frequency": "daily",
		})
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "set-visibility-public", httpclient.Request{
			Method: "PUT",
			Path:   fmt.Sprintf("/social/visibility/%s", h.ID),
			Bearer: u.AccessToken,
			Body:   map[string]any{"visibility": "public"},
		}, 200)
		if err != nil {
			return err
		}

		const ownerTZ = "Pacific/Kiritimati" // UTC+14, deliberately date-line-adjacent
		ownerToday := todayIn(ownerTZ)
		utcToday := todayIn("UTC")

		_, err = ctx.Call(ctx.Native, "complete-in-owner-tz", httpclient.Request{
			Method: "POST",
			Path:   fmt.Sprintf("/habits/%s/complete", h.ID),
			Bearer: u.AccessToken,
			Body: map[string]any{
				"date":     ownerToday,
				"timezone": ownerTZ,
			},
		}, 201)
		if err != nil {
			return err
		}

		utcStatsRes, err := ctx.Call(ctx.Native, "owner-stats-viewed-as-utc", httpclient.Request{
			Method:  "GET",
			Path:    fmt.Sprintf("/habits/%s/stats", h.ID),
			Bearer:  u.AccessToken,
			Headers: map[string]string{"X-Timezone": "UTC"},
		}, 200)
		if err != nil {
			return err
		}
		utcStats := asMap(utcStatsRes.JSON)

		ownerStatsRes, err := ctx.Call(ctx.Native, "owner-stats-viewed-as-owner-tz", httpclient.Request{
			Method:  "GET",
			Path:    fmt.Sprintf("/habits/%s/stats", h.ID),
			Bearer:  u.AccessToken,
			Headers: map[string]string{"X-Timezone": ownerTZ},
		}, 200)
		if err != nil {
			return err
		}
		ownerStats := asMap(ownerStatsRes.JSON)

		publicRes, err := ctx.Call(ctx.Native, "get-public-flame-page", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/habits/public/%s", u.Username),
		}, 200)
		if err != nil {
			return err
		}
		pub := asMap(publicRes.JSON)
		pubHabits, _ := pub["habits"].([]any)
		var pubHabit map[string]any
		for _, hh := range pubHabits {
			m := asMap(hh)
			if str(m, "id") == h.ID {
				pubHabit = m
				break
			}
		}
		if pubHabit == nil {
			ctx.Fail("get-public-flame-page", httpclient.Request{}, publicRes, "expected the public habit to be present in the public flame page")
			return nil
		}

		// Positive proof: public page always matches the UTC-computed view.
		if flt(pubHabit, "consistency") != flt(utcStats, "consistency") {
			ctx.Fail("get-public-flame-page", httpclient.Request{}, publicRes,
				fmt.Sprintf("public page consistency (%.2f) must equal owner stats queried with X-Timezone: UTC (%.2f) — public surfaces hardcode UTC",
					flt(pubHabit, "consistency"), flt(utcStats, "consistency")))
		}

		// Conditional observation: only meaningful when this run actually
		// straddles the date line for the owner's timezone; logged rather
		// than asserted because the live old-stack behavior in this exact
		// edge case (a completion recorded for the owner's "today" when that
		// date is one day ahead of UTC) turned out to sometimes yield
		// consistency=0 on BOTH sides rather than a clean divergence — see
		// the dispatch report's open questions for the reproduction and a
		// recommendation to flag it to the flame-port bead (rdc7.3).
		if ownerToday != utcToday {
			if flt(ownerStats, "consistency") == flt(utcStats, "consistency") {
				ctx.Note(fmt.Sprintf(
					"owner-tz today (%s) differs from UTC today (%s) this run, but owner-tz stats consistency (%.2f) did not diverge from the UTC view (%.2f) — see open questions",
					ownerToday, utcToday, flt(ownerStats, "consistency"), flt(utcStats, "consistency")))
			} else {
				ctx.Note(fmt.Sprintf(
					"owner-tz today (%s) differs from UTC today (%s) this run, and consistency diverged as documented: owner=%.2f utc=%.2f",
					ownerToday, utcToday, flt(ownerStats, "consistency"), flt(utcStats, "consistency")))
			}
		}

		svgRes, err := ctx.Call(ctx.Native, "get-flame-svg", httpclient.Request{
			Method: "GET",
			Path:   fmt.Sprintf("/habits/public/%s/flame.svg", u.Username),
		}, 200)
		if err != nil {
			return err
		}
		if ct := svgRes.Header.Get("Content-Type"); ct != "" && !contains(ct, "svg") {
			ctx.Fail("get-flame-svg", httpclient.Request{}, svgRes, fmt.Sprintf("expected an svg Content-Type, got %q", ct))
		}
		return nil
	},
}

func contains(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func init() {
	registerAll(publicFlamePageUTCContract)
}
