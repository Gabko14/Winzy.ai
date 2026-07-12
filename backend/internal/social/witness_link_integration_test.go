//go:build integration

package social_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

func createWitnessLink(t *testing.T, stack testStack, a map[string]string, label any, habitIDs []string) map[string]any {
	t.Helper()
	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPost, path: "/social/witness-links", headers: a,
		body: map[string]any{"label": label, "habitIds": habitIDs},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("createWitnessLink status = %d, want 201", resp.StatusCode)
	}
	return decodeBody[map[string]any](t, resp)
}

// --- POST /social/witness-links ---

func TestCreateWitnessLink_HappyPath_WithLabelAndHabitsReturns201(t *testing.T) {
	stack := newTestStack(t)
	ownerID := "11111111-1111-1111-1111-111111111111"
	a := bearerFor(t, stack.tokens, ownerID)
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})

	body := createWitnessLink(t, stack, a, "Maya", []string{h1.ID, h2.ID})

	if body["label"] != "Maya" {
		t.Errorf("label = %v, want Maya", body["label"])
	}
	token, _ := body["token"].(string)
	if token == "" {
		t.Error("token is empty, want a generated token")
	}
	habitIDs := body["habitIds"].([]any)
	if len(habitIDs) != 2 {
		t.Errorf("habitIds = %v, want 2 entries", habitIDs)
	}
}

func TestCreateWitnessLink_EdgeCase_NoLabelReturnsNullLabel(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	body := createWitnessLink(t, stack, a, nil, nil)
	if body["label"] != nil {
		t.Errorf("label = %v, want nil", body["label"])
	}
}

func TestCreateWitnessLink_EdgeCase_NoHabitsReturnsEmptyList(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	body := createWitnessLink(t, stack, a, nil, nil)
	if len(body["habitIds"].([]any)) != 0 {
		t.Errorf("habitIds = %v, want empty", body["habitIds"])
	}
}

func TestCreateWitnessLink_EdgeCase_DuplicateHabitIDsDeduplicated(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})

	body := createWitnessLink(t, stack, a, nil, []string{h1.ID, h1.ID, h1.ID})
	if len(body["habitIds"].([]any)) != 1 {
		t.Errorf("habitIds = %v, want exactly 1 after dedup", body["habitIds"])
	}
}

func TestCreateWitnessLink_ErrorCase_LabelTooLongReturns400(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPost, path: "/social/witness-links", headers: a,
		body: map[string]any{"label": strings.Repeat("x", 101)},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCreateWitnessLink_ErrorCase_MissingAuthReturns401(t *testing.T) {
	stack := newTestStack(t)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/witness-links", body: map[string]any{"label": "test"}})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestCreateWitnessLink_ErrorCase_MalformedJSONReturns400(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/witness-links", headers: a, rawBody: "not valid json"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// FIX 4 (winzy.ai-rdc7.4 review): a non-UUID habitIds element must 400 at
// decode time, not reach the database and 500.
func TestCreateWitnessLink_ErrorCase_NonUUIDHabitIDReturns400(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPost, path: "/social/witness-links", headers: a,
		body: map[string]any{"habitIds": []string{"garbage"}},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["error"] != "Invalid JSON in request body" {
		t.Errorf("error = %v, want the generic decode-failure message", body["error"])
	}

	// The link must not have been created at all — no ghost row from a
	// half-completed insert.
	links := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness-links", headers: a})
	linksBody := decodeBody[map[string]any](t, links)
	if len(linksBody["items"].([]any)) != 0 {
		t.Errorf("witness links = %+v, want none created", linksBody["items"])
	}
}

func TestCreateWitnessLink_HappyPath_TokenIsHighEntropy(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	body1 := createWitnessLink(t, stack, a, "Link 1", nil)
	body2 := createWitnessLink(t, stack, a, "Link 2", nil)

	token1, token2 := body1["token"].(string), body2["token"].(string)
	if len(token1) != 43 || len(token2) != 43 {
		t.Errorf("token lengths = %d/%d, want 43 each", len(token1), len(token2))
	}
	if token1 == token2 {
		t.Error("two created links share the same token")
	}
}

// --- GET /social/witness-links ---

func TestListWitnessLinks_HappyPath_ReturnsOwnedLinksOnly(t *testing.T) {
	stack := newTestStack(t)
	ownerID := "11111111-1111-1111-1111-111111111111"
	a := bearerFor(t, stack.tokens, ownerID)
	createWitnessLink(t, stack, a, "Link A", nil)
	createWitnessLink(t, stack, a, "Link B", nil)

	other := bearerFor(t, stack.tokens, "22222222-2222-2222-2222-222222222222")
	createWitnessLink(t, stack, other, "Other link", nil)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness-links", headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if len(body["items"].([]any)) != 2 {
		t.Errorf("items = %+v, want exactly 2 (owner's own links)", body["items"])
	}
}

func TestListWitnessLinks_EdgeCase_ExcludesRevokedLinks(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, a, "Will revoke", nil)
	createWitnessLink(t, stack, a, "Will keep", nil)

	linkID := created["id"].(string)
	doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/witness-links/" + linkID, headers: a})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness-links", headers: a})
	body := decodeBody[map[string]any](t, resp)
	items := body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items = %+v, want exactly 1 remaining", items)
	}
	if items[0].(map[string]any)["label"] != "Will keep" {
		t.Errorf("remaining label = %v, want \"Will keep\"", items[0].(map[string]any)["label"])
	}
}

// --- PUT /social/witness-links/{id} ---

func TestUpdateWitnessLink_HappyPath_ChangeLabelReturns200(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	created := createWitnessLink(t, stack, a, "Old Label", []string{h1.ID})
	linkID := created["id"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/witness-links/" + linkID, headers: a, body: map[string]any{"label": "New Label"}})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["label"] != "New Label" {
		t.Errorf("label = %v, want New Label", body["label"])
	}
	if len(body["habitIds"].([]any)) != 1 {
		t.Errorf("habitIds = %+v, want unchanged (still 1)", body["habitIds"])
	}
}

func TestUpdateWitnessLink_HappyPath_ChangeHabitsReplacesAllowlist(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})
	h3 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Meditation"})
	created := createWitnessLink(t, stack, a, "Test", []string{h1.ID, h2.ID})
	linkID := created["id"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/witness-links/" + linkID, headers: a, body: map[string]any{"habitIds": []string{h3.ID}}})
	body := decodeBody[map[string]any](t, resp)
	habitIDs := body["habitIds"].([]any)
	if len(habitIDs) != 1 || habitIDs[0] != h3.ID {
		t.Errorf("habitIds = %+v, want [%s]", habitIDs, h3.ID)
	}
}

func TestUpdateWitnessLink_ErrorCase_RevokedLinkReturns404(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, a, "Test", nil)
	linkID := created["id"].(string)
	doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/witness-links/" + linkID, headers: a})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/witness-links/" + linkID, headers: a, body: map[string]any{"label": "New"}})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestUpdateWitnessLink_ErrorCase_OtherOwnerReturns404(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, a, "Mine", nil)
	linkID := created["id"].(string)

	other := bearerFor(t, stack.tokens, "22222222-2222-2222-2222-222222222222")
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/witness-links/" + linkID, headers: other, body: map[string]any{"label": "Hacked"}})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// FIX 7 (winzy.ai-rdc7.4 review): UpdateWitnessLink's validation order
// matches the C#'s body -> label -> ownership lookup (404) -> habitIds
// count check. A foreign link with an over-limit habitIds array must 404,
// not 400 — the ownership check runs first and the count check is never
// reached for a link this caller doesn't own.
func TestUpdateWitnessLink_ErrorCase_ForeignLinkWithOverLimitHabitsReturns404NotBadRequest(t *testing.T) {
	stack := newTestStack(t)
	owner := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, owner, "Mine", nil)
	linkID := created["id"].(string)

	tooMany := make([]string, 51)
	for i := range tooMany {
		tooMany[i] = "11111111-1111-1111-1111-11111111111" + string(rune('0'+i%10))
	}

	other := bearerFor(t, stack.tokens, "22222222-2222-2222-2222-222222222222")
	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPut, path: "/social/witness-links/" + linkID, headers: other,
		body: map[string]any{"habitIds": tooMany},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (ownership check must run before the habit-count check)", resp.StatusCode)
	}
}

func TestUpdateWitnessLink_ErrorCase_LabelTooLongReturns400(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, a, "Test", nil)
	linkID := created["id"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/witness-links/" + linkID, headers: a, body: map[string]any{"label": strings.Repeat("x", 101)}})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// --- DELETE /social/witness-links/{id} (revoke) ---

func TestRevokeWitnessLink_HappyPath_Returns204(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, a, "Test", nil)
	linkID := created["id"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/witness-links/" + linkID, headers: a})
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
}

func TestRevokeWitnessLink_ErrorCase_AlreadyRevokedReturns404(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, a, "Test", nil)
	linkID := created["id"].(string)
	doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/witness-links/" + linkID, headers: a})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/witness-links/" + linkID, headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestRevokeWitnessLink_ErrorCase_OtherOwnerReturns404(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, a, "Test", nil)
	linkID := created["id"].(string)

	other := bearerFor(t, stack.tokens, "22222222-2222-2222-2222-222222222222")
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/witness-links/" + linkID, headers: other})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// --- POST /social/witness-links/{id}/rotate ---

func TestRotateToken_HappyPath_GeneratesNewToken(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	created := createWitnessLink(t, stack, a, "Test", []string{h1.ID})
	linkID := created["id"].(string)
	oldToken := created["token"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/witness-links/" + linkID + "/rotate", headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	newToken := body["token"].(string)
	if newToken == oldToken {
		t.Error("token unchanged after rotate")
	}
	if body["label"] != "Test" || len(body["habitIds"].([]any)) != 1 {
		t.Errorf("body = %+v, want label/habitIds preserved", body)
	}
}

func TestRotateToken_HappyPath_OldTokenStopsWorking(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	created := createWitnessLink(t, stack, a, "Test", []string{h1.ID})
	linkID := created["id"].(string)
	oldToken := created["token"].(string)

	resp1 := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + oldToken})
	if resp1.StatusCode != http.StatusOK {
		t.Fatalf("old token before rotate: status = %d, want 200", resp1.StatusCode)
	}

	rotateResp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/witness-links/" + linkID + "/rotate", headers: a})
	newToken := decodeBody[map[string]any](t, rotateResp)["token"].(string)

	resp2 := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + oldToken})
	if resp2.StatusCode != http.StatusNotFound {
		t.Errorf("old token after rotate: status = %d, want 404", resp2.StatusCode)
	}
	resp3 := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + newToken})
	if resp3.StatusCode != http.StatusOK {
		t.Errorf("new token after rotate: status = %d, want 200", resp3.StatusCode)
	}
}

func TestRotateToken_ErrorCase_RevokedLinkReturns404(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, a, "Test", nil)
	linkID := created["id"].(string)
	doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/witness-links/" + linkID, headers: a})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/witness-links/" + linkID + "/rotate", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// --- GET /social/witness/{token} (anonymous viewer) ---

func TestViewWitnessLink_HappyPath_ShowsOnlySelectedHabits(t *testing.T) {
	stack := newTestStack(t)
	ownerID := "11111111-1111-1111-1111-111111111111"
	a := bearerFor(t, stack.tokens, ownerID)
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})
	h3 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Meditation"})
	created := createWitnessLink(t, stack, a, "Maya", []string{h1.ID, h2.ID})
	token := created["token"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + token})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if got := resp.Header.Get("X-Robots-Tag"); got != "noindex" {
		t.Errorf("X-Robots-Tag = %q, want noindex", got)
	}
	body := decodeBody[map[string]any](t, resp)
	habitsOut := body["habits"].([]any)
	if len(habitsOut) != 2 {
		t.Fatalf("habits = %+v, want exactly 2 (h1, h2 — not h3)", habitsOut)
	}
	names := map[string]bool{}
	for _, hb := range habitsOut {
		names[hb.(map[string]any)["name"].(string)] = true
	}
	if !names["Workout"] || !names["Reading"] || names["Meditation"] {
		t.Errorf("names = %+v, want Workout+Reading present, Meditation absent", names)
	}
	_ = h3
}

func TestViewWitnessLink_HappyPath_IncludesFlameData(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/habits/" + h1.ID + "/complete", headers: a, body: habits.CompleteHabitRequest{Timezone: "UTC"}})
	created := createWitnessLink(t, stack, a, "Test", []string{h1.ID})
	token := created["token"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + token})
	body := decodeBody[map[string]any](t, resp)
	habit := body["habits"].([]any)[0].(map[string]any)
	if habit["flameLevel"] == "none" {
		t.Errorf("flameLevel = %v, want a non-none level after a completion", habit["flameLevel"])
	}
}

func TestViewWitnessLink_ErrorCase_RevokedTokenReturns404(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, a, "Test", nil)
	token := created["token"].(string)
	linkID := created["id"].(string)
	doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/witness-links/" + linkID, headers: a})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + token})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestViewWitnessLink_ErrorCase_InvalidTokenReturnsSafe404(t *testing.T) {
	stack := newTestStack(t)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/totally-invalid-token-that-does-not-exist"})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["error"] != "This witness link is not available" {
		t.Errorf("error = %v, want the verbatim C# message", body["error"])
	}
}

func TestViewWitnessLink_EdgeCase_MalformedTokenLengthReturnsSafe404(t *testing.T) {
	stack := newTestStack(t)

	resp1 := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/abc"})
	if resp1.StatusCode != http.StatusNotFound {
		t.Errorf("too-short token: status = %d, want 404", resp1.StatusCode)
	}

	resp2 := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + strings.Repeat("a", 65)})
	if resp2.StatusCode != http.StatusNotFound {
		t.Errorf("too-long token: status = %d, want 404", resp2.StatusCode)
	}
}

func TestViewWitnessLink_EdgeCase_SameResponseForRevokedAndUnknown(t *testing.T) {
	// Constant-time-404: both branches run findWitnessLinkByToken then check
	// RevokedAt in Go afterward (see witness_store.go's doc comment) — assert
	// the responses are shape-identical, not just both 404.
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	created := createWitnessLink(t, stack, a, "Test", nil)
	revokedToken := created["token"].(string)
	doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/witness-links/" + created["id"].(string), headers: a})

	revokedResp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + revokedToken})
	unknownResp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0"})

	if revokedResp.StatusCode != http.StatusNotFound || unknownResp.StatusCode != http.StatusNotFound {
		t.Fatalf("status codes = %d/%d, want 404/404", revokedResp.StatusCode, unknownResp.StatusCode)
	}
	revokedBody := decodeBody[map[string]any](t, revokedResp)
	unknownBody := decodeBody[map[string]any](t, unknownResp)
	if revokedBody["error"] != unknownBody["error"] {
		t.Errorf("error messages differ: revoked=%v unknown=%v, want identical (no info leakage)", revokedBody["error"], unknownBody["error"])
	}
}

func TestViewWitnessLink_EdgeCase_NoHabitsSelectedReturnsEmptyHabits(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	created := createWitnessLink(t, stack, a, nil, nil)
	token := created["token"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + token})
	body := decodeBody[map[string]any](t, resp)
	if len(body["habits"].([]any)) != 0 {
		t.Errorf("habits = %+v, want empty (no habits selected)", body["habits"])
	}
}

func TestViewWitnessLink_EdgeCase_ArchivedHabitDisappearsFromPage(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})
	created := createWitnessLink(t, stack, a, "Test", []string{h1.ID, h2.ID})
	token := created["token"].(string)

	// Archive h2 — HabitsForUser only returns non-archived habits, so it
	// disappears from the witness page even though it's still in the
	// link's own allowlist (matching "archived habits vanish from
	// habit-service's user list" in the old system).
	archiveResp := doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/habits/" + h2.ID, headers: a})
	if archiveResp.StatusCode != http.StatusNoContent {
		t.Fatalf("archiving h2: status = %d, want 204", archiveResp.StatusCode)
	}

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + token})
	body := decodeBody[map[string]any](t, resp)
	if len(body["habits"].([]any)) != 1 {
		t.Errorf("habits = %+v, want exactly 1 (h1 only, h2 archived)", body["habits"])
	}
}

func TestMultipleWitnessLinks_DifferentHabitSelections(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})

	link1 := createWitnessLink(t, stack, a, "Maya", []string{h1.ID, h2.ID})
	link2 := createWitnessLink(t, stack, a, "Coach Sam", []string{h1.ID})

	resp1 := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + link1["token"].(string)})
	body1 := decodeBody[map[string]any](t, resp1)
	if len(body1["habits"].([]any)) != 2 {
		t.Errorf("Maya's link habits = %+v, want 2", body1["habits"])
	}

	resp2 := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + link2["token"].(string)})
	body2 := decodeBody[map[string]any](t, resp2)
	if len(body2["habits"].([]any)) != 1 {
		t.Errorf("Coach's link habits = %+v, want 1", body2["habits"])
	}
}

func TestWitnessLink_EdgeCase_HabitRemovedFromAllowlistNoLongerVisible(t *testing.T) {
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Reading"})
	created := createWitnessLink(t, stack, a, "Test", []string{h1.ID, h2.ID})
	linkID, token := created["id"].(string), created["token"].(string)

	resp1 := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + token})
	body1 := decodeBody[map[string]any](t, resp1)
	if len(body1["habits"].([]any)) != 2 {
		t.Fatalf("initial habits = %+v, want 2", body1["habits"])
	}

	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/witness-links/" + linkID, headers: a, body: map[string]any{"habitIds": []string{h1.ID}}})

	resp2 := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + token})
	body2 := decodeBody[map[string]any](t, resp2)
	habitsOut := body2["habits"].([]any)
	if len(habitsOut) != 1 || habitsOut[0].(map[string]any)["name"] != "Workout" {
		t.Errorf("after allowlist update: habits = %+v, want just Workout", habitsOut)
	}
}

func TestViewWitnessLink_EdgeCase_UnregisteredOwnerStillReturnsHabits(t *testing.T) {
	// The owner never called auth.Register (bearerFor mints a token without
	// registering — see testserver's identical convention for habits), so
	// auth.BatchProfiles returns nothing for them; the witness page must
	// still show habits, with owner info degraded to null — matching
	// WitnessViewer_AuthServiceDown_StillReturnsHabits's contract without an
	// HTTP mock to fault-inject (see the bead report's open questions).
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")
	h1 := createHabit(t, stack.srv, a, habits.CreateHabitRequest{Name: "Workout"})
	created := createWitnessLink(t, stack, a, "Test", []string{h1.ID})
	token := created["token"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/witness/" + token})
	body := decodeBody[map[string]any](t, resp)
	if len(body["habits"].([]any)) != 1 {
		t.Errorf("habits = %+v, want 1 despite no owner profile", body["habits"])
	}
	if body["ownerUsername"] != nil {
		t.Errorf("ownerUsername = %v, want nil (owner never registered)", body["ownerUsername"])
	}
}
