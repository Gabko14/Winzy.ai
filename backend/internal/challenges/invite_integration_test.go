//go:build integration

package challenges_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func validInviteBody() map[string]any {
	return map[string]any{
		"habitName": "Morning run", "habitIcon": "🏃",
		"frequency": "daily", "milestoneType": "consistencyTarget",
		"targetValue": 80.0, "periodDays": 30,
		"rewardDescription": "Loser buys coffee",
	}
}

func TestCreateInvite_HappyPath_CreateListPublicRoundtrip(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	display := "Alex Creator"
	creator, err := stack.authService.Register(context.Background(),
		"inv-creator1@example.com", "invcreator1", "Password123!", &display)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	status, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	if status != 201 {
		t.Fatalf("create status=%d body=%v", status, created)
	}
	token, _ := created["token"].(string)
	id, _ := created["id"].(string)
	url, _ := created["url"].(string)
	if token == "" || id == "" {
		t.Fatalf("missing id/token: %v", created)
	}
	if len(token) != 43 {
		t.Fatalf("token length=%d want 43", len(token))
	}
	if url != "http://localhost:8081/ci/"+token {
		t.Fatalf("url=%q", url)
	}

	status, list := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites", headers: auth,
	})
	if status != 200 {
		t.Fatalf("list status=%d body=%v", status, list)
	}
	items, _ := list["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items len=%d want 1", len(items))
	}

	status, view := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/" + token,
	})
	if status != 200 {
		t.Fatalf("view status=%d body=%v", status, view)
	}
	if view["habitName"] != "Morning run" {
		t.Fatalf("habitName=%v", view["habitName"])
	}
	if view["status"] != "pending" {
		t.Fatalf("status=%v", view["status"])
	}
	if view["creatorDisplayName"] != display {
		t.Fatalf("creatorDisplayName=%v want %s", view["creatorDisplayName"], display)
	}
	if view["avatarUrl"] != nil {
		t.Fatalf("avatarUrl=%v want null (no avatar uploaded)", view["avatarUrl"])
	}
	if view["milestoneType"] != "consistencyTarget" {
		t.Fatalf("milestoneType=%v", view["milestoneType"])
	}
}

func TestViewInvite_HappyPath_CarriesCreatorAvatarURL(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	display := "Avatar Creator"
	creator, err := stack.authService.Register(context.Background(),
		"inv-avatar@example.com", "invavatar", "Password123!", &display)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	avatar := "https://cdn.example.com/creator.png"
	if _, err := stack.authService.UpdateProfile(context.Background(), creator.User.ID, auth.UpdateProfileRequest{
		AvatarURL: &avatar,
	}); err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	authHdr := bearerFor(t, stack.tokens, creator.User.ID)

	status, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: authHdr, body: validInviteBody(),
	})
	if status != 201 {
		t.Fatalf("create status=%d body=%v", status, created)
	}
	token, _ := created["token"].(string)

	status, view := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/" + token,
	})
	if status != 200 {
		t.Fatalf("view status=%d body=%v", status, view)
	}
	if view["avatarUrl"] != avatar {
		t.Fatalf("avatarUrl=%v want %s", view["avatarUrl"], avatar)
	}
	if view["creatorDisplayName"] != display {
		t.Fatalf("creatorDisplayName=%v want %s", view["creatorDisplayName"], display)
	}
}

func TestRevokeInvite_HappyPath_PublicShowsRevoked(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "inv-creator2@example.com", "invcreator2")
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	id, token := created["id"].(string), created["token"].(string)

	status, _ := doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/challenges/invites/" + id, headers: auth,
	})
	if status != 204 {
		t.Fatalf("revoke status=%d", status)
	}

	// Idempotent second revoke.
	status, _ = doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/challenges/invites/" + id, headers: auth,
	})
	if status != 204 {
		t.Fatalf("second revoke status=%d", status)
	}

	status, list := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites", headers: auth,
	})
	if status != 200 {
		t.Fatalf("list status=%d", status)
	}
	items, _ := list["items"].([]any)
	if len(items) != 0 {
		t.Fatalf("pending list len=%d want 0 after revoke", len(items))
	}

	status, view := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/" + token,
	})
	if status != 200 || view["status"] != "revoked" {
		t.Fatalf("view status=%d body=%v", status, view)
	}
}

func TestCreateInvite_EdgeCase_PendingCap(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "inv-creator3@example.com", "invcreator3")
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	var firstID string
	for i := 0; i < 20; i++ {
		status, body := doRequest(t, stack.srv, testRequest{
			method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
		})
		if status != 201 {
			t.Fatalf("create #%d status=%d body=%v", i+1, status, body)
		}
		if i == 0 {
			firstID = body["id"].(string)
		}
	}

	status, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	if status != 409 || body["error"] != "Maximum of 20 pending invites reached" {
		t.Fatalf("21st create status=%d body=%v", status, body)
	}

	// Revoked don't count toward the cap.
	status, _ = doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/challenges/invites/" + firstID, headers: auth,
	})
	if status != 204 {
		t.Fatalf("revoke status=%d", status)
	}
	status, body = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	if status != 201 {
		t.Fatalf("create after revoke status=%d body=%v", status, body)
	}

	// Claimed don't count toward the cap.
	_, err := stack.pool.Exec(context.Background(), `
		UPDATE challenge_invites SET status = 'claimed', claimed_at = now()
		WHERE id = (
			SELECT id FROM challenge_invites
			WHERE creator_id = $1::uuid AND status = 'pending'
			LIMIT 1
		)`, creator.User.ID)
	if err != nil {
		t.Fatalf("mark claimed: %v", err)
	}
	status, body = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	if status != 201 {
		t.Fatalf("create after claim status=%d body=%v", status, body)
	}
}

func TestViewInvite_EdgeCase_ExpiredComputedStatus(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "inv-creator4@example.com", "invcreator4")
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	token := created["token"].(string)

	_, err := stack.pool.Exec(context.Background(), `
		UPDATE challenge_invites SET expires_at = now() - interval '1 minute'
		WHERE token = $1`, token)
	if err != nil {
		t.Fatalf("expire: %v", err)
	}

	status, view := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/" + token,
	})
	if status != 200 || view["status"] != "expired" {
		t.Fatalf("view status=%d body=%v", status, view)
	}
}

func TestViewInvite_EdgeCase_TokenLengthPrecheck(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)

	status, _ := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/abc",
	})
	if status != 404 {
		t.Fatalf("short token status=%d want 404", status)
	}

	status, _ = doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/" + strings.Repeat("a", 65),
	})
	if status != 404 {
		t.Fatalf("long token status=%d want 404", status)
	}

	status, _ = doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/" + strings.Repeat("A", 43),
	})
	if status != 404 {
		t.Fatalf("unknown 43-char token status=%d want 404", status)
	}
}

func TestCreateInvite_ErrorCase_ValidationMatrix(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "inv-creator5@example.com", "invcreator5")
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	cases := []struct {
		name string
		body map[string]any
		want string
	}{
		{"blank name", map[string]any{
			"habitName": "  ", "frequency": "daily", "milestoneType": "consistencyTarget",
			"targetValue": 80.0, "periodDays": 30, "rewardDescription": "Coffee",
		}, "HabitName is required"},
		{"bad frequency", map[string]any{
			"habitName": "Run", "frequency": "DAILY", "milestoneType": "consistencyTarget",
			"targetValue": 80.0, "periodDays": 30, "rewardDescription": "Coffee",
		}, "Invalid Frequency"},
		{"custom without days", map[string]any{
			"habitName": "Run", "frequency": "custom", "milestoneType": "consistencyTarget",
			"targetValue": 80.0, "periodDays": 30, "rewardDescription": "Coffee",
		}, "CustomDays required for Weekly and Custom frequency"},
		{"customDays out of range", map[string]any{
			"habitName": "Run", "frequency": "custom", "customDays": []int{7},
			"milestoneType": "consistencyTarget", "targetValue": 80.0, "periodDays": 30,
			"rewardDescription": "Coffee",
		}, "CustomDays must be integers between 0 and 6"},
		{"unsupported milestone", map[string]any{
			"habitName": "Run", "frequency": "daily", "milestoneType": "daysInPeriod",
			"targetValue": 5.0, "periodDays": 30, "rewardDescription": "Coffee",
		}, "Invalid MilestoneType"},
		{"blank reward", map[string]any{
			"habitName": "Run", "frequency": "daily", "milestoneType": "consistencyTarget",
			"targetValue": 80.0, "periodDays": 30, "rewardDescription": "  ",
		}, "RewardDescription is required"},
		{"bad period", map[string]any{
			"habitName": "Run", "frequency": "daily", "milestoneType": "consistencyTarget",
			"targetValue": 80.0, "periodDays": 0, "rewardDescription": "Coffee",
		}, "PeriodDays must be between 1 and 365"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, body := doRequest(t, stack.srv, testRequest{
				method: "POST", path: "/challenges/invites", headers: auth, body: tc.body,
			})
			if status != 400 || body["error"] != tc.want {
				t.Fatalf("status=%d body=%v want error %q", status, body, tc.want)
			}
		})
	}
}

func TestRevokeInvite_ErrorCase_OthersInvite404(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "inv-creator6@example.com", "invcreator6")
	other := registerUser(t, stack.authService, "inv-other6@example.com", "invother6")
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	id := created["id"].(string)

	status, _ := doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/challenges/invites/" + id,
		headers: bearerFor(t, stack.tokens, other.User.ID),
	})
	if status != 404 {
		t.Fatalf("revoke others status=%d want 404", status)
	}
}

func TestInviteRoutes_ErrorCase_Unauthenticated401(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)

	status, _ := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", body: validInviteBody(),
	})
	if status != 401 {
		t.Fatalf("POST status=%d want 401", status)
	}
	status, _ = doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites",
	})
	if status != 401 {
		t.Fatalf("GET list status=%d want 401", status)
	}
	status, _ = doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/challenges/invites/11111111-1111-1111-1111-111111111111",
	})
	if status != 401 {
		t.Fatalf("DELETE status=%d want 401", status)
	}
}

func TestViewInvite_HappyPath_NoAuthRequired(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "inv-creator7@example.com", "invcreator7")
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	token := created["token"].(string)

	status, view := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/" + token,
	})
	if status != 200 {
		t.Fatalf("public view status=%d body=%v", status, view)
	}
}

func TestUserDeleted_CascadesInvites(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "inv-creator8@example.com", "invcreator8")
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	token := created["token"].(string)

	if err := stack.authService.DeleteAccount(context.Background(), creator.User.ID); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	status, _ := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/" + token,
	})
	if status != 404 {
		t.Fatalf("view after cascade status=%d want 404", status)
	}
}

func TestExportSection_IncludesPendingInvites(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "inv-creator9@example.com", "invcreator9")
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	status, _ := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	if status != 201 {
		t.Fatalf("create status=%d", status)
	}

	sections, _ := stack.exportReg.Export(context.Background(), creator.User.ID)
	found := false
	for _, s := range sections {
		if s.Service != "challenge" {
			continue
		}
		found = true
		raw, err := json.Marshal(s.Data)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var parsed map[string]any
		if err := json.Unmarshal(raw, &parsed); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		invites, _ := parsed["invites"].([]any)
		if len(invites) != 1 {
			t.Fatalf("invites=%v want 1", parsed["invites"])
		}
	}
	if !found {
		t.Fatal("challenge export section missing")
	}
}

func TestListInvites_EdgeCase_NewestFirst(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "inv-creator10@example.com", "invcreator10")
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	var tokens []string
	for i := 0; i < 3; i++ {
		_, body := doRequest(t, stack.srv, testRequest{
			method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
		})
		tokens = append(tokens, body["token"].(string))
		time.Sleep(5 * time.Millisecond)
	}

	status, list := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites", headers: auth,
	})
	if status != 200 {
		t.Fatalf("list status=%d", status)
	}
	items := list["items"].([]any)
	if len(items) != 3 {
		t.Fatalf("len=%d", len(items))
	}
	first := items[0].(map[string]any)["token"].(string)
	if first != tokens[2] {
		t.Fatalf("newest first: got %s want %s", first, tokens[2])
	}
}
