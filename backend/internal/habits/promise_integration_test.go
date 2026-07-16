//go:build integration

// Package habits_test's promise suite ports PromiseEndpointTests.cs's CRUD,
// validation, and ownership coverage for POST/GET/DELETE
// /habits/{id}/promise and PATCH /habits/{id}/promise/visibility. Lazy
// resolution (Kept/EndedBelow) is covered separately in
// promise_lazy_resolution_integration_test.go, which needs Service.SetClock
// rather than an HTTP round trip. The C#'s *_MissingUserIdHeader_Returns400
// cases don't port: this stack's JWT middleware rejects an unauthenticated
// request with 401 before any handler runs (see TestCreatePromise_ErrorCase_UnauthenticatedReturns401
// below), unlike the old gateway-trusts-X-User-Id model the C# tests probed
// directly — this divergence already applies to every other habits endpoint,
// not just promises.
package habits_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

func futureDate(days int) string {
	return time.Now().UTC().AddDate(0, 0, days).Format("2006-01-02")
}

// --- Happy path: CreatePromise ---

func TestCreatePromise_HappyPath_ReturnsCreatedWithFields(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000001"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body := decodeBody[habits.PromiseResponse](t, resp)
	if body.TargetConsistency != 70 {
		t.Errorf("TargetConsistency = %v, want 70", body.TargetConsistency)
	}
	if body.Status != "active" {
		t.Errorf("Status = %q, want active", body.Status)
	}
	if !strings.Contains(body.Statement, "70%") {
		t.Errorf("Statement = %q, want it to contain 70%%", body.Statement)
	}
	if body.IsPublicOnFlame {
		t.Error("IsPublicOnFlame should default to false")
	}
	if resp.Header.Get("Location") == "" {
		t.Error("response should set a Location header")
	}
}

func TestCreatePromise_HappyPath_WithPrivateNotePersists(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000002"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 80, EndDate: futureDate(30), PrivateNote: strPtr("I really want to keep this up")},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body := decodeBody[habits.PromiseResponse](t, resp)
	if body.PrivateNote == nil || *body.PrivateNote != "I really want to keep this up" {
		t.Errorf("PrivateNote = %v, want the note", body.PrivateNote)
	}
}

func TestCreatePromise_HappyPath_WithIsPublicOnFlamePersistsValue(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000003"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30), IsPublicOnFlame: boolPtr(true)},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body := decodeBody[habits.PromiseResponse](t, resp)
	if !body.IsPublicOnFlame {
		t.Error("IsPublicOnFlame = false, want true")
	}
}

func TestCreatePromise_HappyPath_StatementIncludesTargetAndMonthName(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000004"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	endDate := futureDate(30)
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 75, EndDate: endDate},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body := decodeBody[habits.PromiseResponse](t, resp)
	parsed, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		t.Fatalf("parsing endDate: %v", err)
	}
	if !strings.Contains(body.Statement, "75%") || !strings.Contains(body.Statement, parsed.Format("January")) {
		t.Errorf("Statement = %q, want it to contain 75%% and %s", body.Statement, parsed.Format("January"))
	}
}

func TestCreatePromise_EdgeCase_Target1And100Accepted(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000005"))

	for i, target := range []float64{1, 100} {
		habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Habit"})
		resp := doRequest(t, srv, testRequest{
			method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
			body: habits.CreatePromiseRequest{TargetConsistency: target, EndDate: futureDate(30)},
		})
		if resp.StatusCode != http.StatusCreated {
			t.Errorf("target %v (case %d): status = %d, want 201", target, i, resp.StatusCode)
		}
	}
}

func TestCreatePromise_HappyPath_DifferentHabitsBothSucceed(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000006"))
	habit1 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	habit2 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Exercise"})

	r1 := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit1.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	r2 := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit2.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 60, EndDate: futureDate(30)},
	})
	if r1.StatusCode != http.StatusCreated || r2.StatusCode != http.StatusCreated {
		t.Errorf("status = %d, %d, want 201, 201", r1.StatusCode, r2.StatusCode)
	}
}

// --- Error conditions: CreatePromise validation ---

func TestCreatePromise_ErrorCase_TargetTooLowReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000010"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 0, EndDate: futureDate(30)},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if !strings.Contains(body["error"], "between 1 and 100") {
		t.Errorf("error = %q, want it to mention the 1-100 range", body["error"])
	}
}

func TestCreatePromise_ErrorCase_TargetTooHighReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000011"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 101, EndDate: futureDate(30)},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCreatePromise_ErrorCase_PastEndDateReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000012"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(-1)},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if !strings.Contains(body["error"], "future") {
		t.Errorf("error = %q, want it to mention 'future'", body["error"])
	}
}

func TestCreatePromise_EdgeCase_TodayEndDateReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000013"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(0)},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (end date == today is not strictly in the future)", resp.StatusCode)
	}
}

func TestCreatePromise_ErrorCase_InvalidDateFormatReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000014"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: "not-a-date"},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCreatePromise_ErrorCase_PrivateNoteTooLongReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000015"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30), PrivateNote: strPtr(strings.Repeat("a", 513))},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// TestCreatePromise_EdgeCase_PrivateNoteLengthCountsUTF16CodeUnitsNotBytes
// proves the 512-character limit counts UTF-16 code units like C#'s
// `privateNote.Length`, not UTF-8 bytes: "é" is 2 bytes in UTF-8 but a
// single UTF-16 code unit (it's in the Basic Multilingual Plane), so 512
// of them is 1024 bytes yet still exactly at the limit (accepted), and 513
// is one code unit over (rejected) — a byte-counting implementation would
// wrongly reject the accepted case at 256 characters already.
func TestCreatePromise_EdgeCase_PrivateNoteLengthCountsUTF16CodeUnitsNotBytes(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000018"))

	habitAtLimit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	atLimit := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habitAtLimit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30), PrivateNote: strPtr(strings.Repeat("é", 512))},
	})
	if atLimit.StatusCode != http.StatusCreated {
		body := decodeBody[map[string]string](t, atLimit)
		t.Errorf("512 'é' characters (1024 UTF-8 bytes, 512 UTF-16 code units): status = %d, want 201; error = %q", atLimit.StatusCode, body["error"])
	}

	habitOverLimit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	overLimit := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habitOverLimit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30), PrivateNote: strPtr(strings.Repeat("é", 513))},
	})
	if overLimit.StatusCode != http.StatusBadRequest {
		t.Errorf("513 'é' characters: status = %d, want 400", overLimit.StatusCode)
	}
}

func TestCreatePromise_ErrorCase_MalformedJSONReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000016"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a, rawBody: "{invalid json"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] != "Invalid JSON in request body" {
		t.Errorf(`error = %q, want "Invalid JSON in request body"`, body["error"])
	}
}

func TestCreatePromise_ErrorCase_EmptyBodyReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000017"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

// TestCreatePromise_EdgeCase_LiteralNullBodyReturnsBodyRequired proves a
// literal JSON `null` body is distinguished from malformed JSON: C#'s
// System.Text.Json parses `null` successfully into a null reference (not an
// exception), and CreatePromise's own `if (request is null) return
// BadRequest("Request body is required")` check in PromiseEndpoints.cs
// then fires — a DIFFERENT message than "Invalid JSON in request body".
func TestCreatePromise_EdgeCase_LiteralNullBodyReturnsBodyRequired(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000019"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a, rawBody: "null"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] != "Request body is required" {
		t.Errorf(`error = %q, want "Request body is required"`, body["error"])
	}
}

// TestCreatePromise_EdgeCase_TrailingGarbageAfterValidJSONReturns400 proves
// trailing non-whitespace content after a complete JSON value is rejected,
// matching System.Text.Json's JsonSerializer (which requires the ENTIRE
// body to be consumed) — Go's json.Decoder otherwise silently decodes the
// first value and ignores whatever comes after it.
func TestCreatePromise_EdgeCase_TrailingGarbageAfterValidJSONReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000029"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	rawBody := `{"targetConsistency":70,"endDate":"` + futureDate(30) + `"} trailing garbage`
	resp := doRequest(t, srv, testRequest{method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a, rawBody: rawBody})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] != "Invalid JSON in request body" {
		t.Errorf(`error = %q, want "Invalid JSON in request body"`, body["error"])
	}
}

func TestCreatePromise_ErrorCase_UnauthenticatedReturns401(t *testing.T) {
	t.Parallel()
	srv, _, _ := newTestServer(t)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/00000000-0000-4000-8000-000000000099/promise",
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 (no Authorization header)", resp.StatusCode)
	}
}

// --- Error conditions: CreatePromise ownership/existence ---

func TestCreatePromise_ErrorCase_NonExistentHabitReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000020"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + newUserID(t, "999999999999") + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestCreatePromise_ErrorCase_GarbageHabitIDReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000021"))

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/not-a-uuid/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (garbage UUID must not 500)", resp.StatusCode)
	}
}

func TestCreatePromise_ErrorCase_OtherUsersHabitReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	other := bearerFor(t, tokens, newUserID(t, "300000000022"))
	habit := createHabit(t, srv, other, habits.CreateHabitRequest{Name: "Reading"})

	mine := bearerFor(t, tokens, newUserID(t, "300000000023"))
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: mine,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestCreatePromise_ErrorCase_ArchivedHabitReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000024"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID, headers: a})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestCreatePromise_ErrorCase_DuplicateActiveReturns409(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000025"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 80, EndDate: futureDate(60)},
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if !strings.Contains(body["error"], "active promise") {
		t.Errorf("error = %q, want it to mention 'active promise'", body["error"])
	}
}

// --- GetPromise ---

func TestGetPromise_HappyPath_ActivePromiseReturnsOnTrackStatus(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000030"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 50, EndDate: futureDate(30)},
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/" + habit.ID + "/promise", headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.GetPromiseResponse](t, resp)
	if body.Active == nil {
		t.Fatal("Active = nil, want the just-created promise")
	}
	if body.Active.Status != "active" {
		t.Errorf("Active.Status = %q, want active", body.Active.Status)
	}
	if body.Active.OnTrack == nil {
		t.Error("Active.OnTrack should be non-nil for an active promise with a computed consistency")
	}
	if body.Active.CurrentConsistency == nil {
		t.Error("Active.CurrentConsistency should be non-nil for an active promise")
	}
	if body.History == nil {
		t.Error("History should be an empty slice, not nil")
	}
}

func TestGetPromise_HappyPath_NoActivePromiseReturnsNullActive(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000031"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/" + habit.ID + "/promise", headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.GetPromiseResponse](t, resp)
	if body.Active != nil {
		t.Errorf("Active = %+v, want nil", body.Active)
	}
}

func TestGetPromise_HappyPath_WithHistoryReturnsResolvedPromises(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000032"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID + "/promise", headers: a})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 60, EndDate: futureDate(60)},
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/" + habit.ID + "/promise?history=true", headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[habits.GetPromiseResponse](t, resp)
	if body.Active == nil || body.Active.TargetConsistency != 60 {
		t.Fatalf("Active = %+v, want the 60%% promise", body.Active)
	}
	if len(body.History) != 1 || body.History[0].Status != "cancelled" {
		t.Fatalf("History = %+v, want exactly one 'cancelled' entry", body.History)
	}
}

func TestGetPromise_HappyPath_IncludesIsPublicOnFlame(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000033"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30), IsPublicOnFlame: boolPtr(true)},
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/" + habit.ID + "/promise", headers: a})
	body := decodeBody[habits.GetPromiseResponse](t, resp)
	if body.Active == nil || !body.Active.IsPublicOnFlame {
		t.Errorf("Active.IsPublicOnFlame = %+v, want true", body.Active)
	}
}

func TestGetPromise_ErrorCase_DifferentUserReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	owner := bearerFor(t, tokens, newUserID(t, "300000000034"))
	habit := createHabit(t, srv, owner, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: owner,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})

	other := bearerFor(t, tokens, newUserID(t, "300000000035"))
	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/" + habit.ID + "/promise", headers: other})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestGetPromise_ErrorCase_GarbageHabitIDReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000036"))

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/garbage-id/promise", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// --- CancelPromise ---

func TestCancelPromise_HappyPath_Returns204AndMarksCancelled(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000040"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID + "/promise", headers: a})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}

	getResp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/" + habit.ID + "/promise?history=true", headers: a})
	body := decodeBody[habits.GetPromiseResponse](t, getResp)
	if len(body.History) != 1 || body.History[0].Status != "cancelled" || body.History[0].ResolvedAt == nil {
		t.Errorf("History = %+v, want exactly one cancelled entry with a ResolvedAt", body.History)
	}
}

func TestCancelPromise_HappyPath_ThenCreateNewSucceeds(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000041"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID + "/promise", headers: a})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 50, EndDate: futureDate(60)},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Errorf("status = %d, want 201", resp.StatusCode)
	}
}

func TestCancelPromise_ErrorCase_NoActivePromiseReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000042"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID + "/promise", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestCancelPromise_ErrorCase_AlreadyCancelledReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000043"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})
	doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID + "/promise", headers: a})

	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID + "/promise", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestCancelPromise_ErrorCase_OtherUsersHabitReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	owner := bearerFor(t, tokens, newUserID(t, "300000000044"))
	habit := createHabit(t, srv, owner, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: owner,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})

	other := bearerFor(t, tokens, newUserID(t, "300000000045"))
	resp := doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + habit.ID + "/promise", headers: other})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// --- ToggleVisibility ---

func TestToggleVisibility_HappyPath_SetPublicReturnsOk(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000050"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPatch, path: "/habits/" + habit.ID + "/promise/visibility", headers: a,
		body: habits.UpdatePromiseVisibilityRequest{IsPublicOnFlame: true},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]bool](t, resp)
	if !body["isPublicOnFlame"] {
		t.Error("isPublicOnFlame = false, want true")
	}
}

func TestToggleVisibility_HappyPath_SetPrivateReturnsOk(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000051"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30), IsPublicOnFlame: boolPtr(true)},
	})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPatch, path: "/habits/" + habit.ID + "/promise/visibility", headers: a,
		body: habits.UpdatePromiseVisibilityRequest{IsPublicOnFlame: false},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]bool](t, resp)
	if body["isPublicOnFlame"] {
		t.Error("isPublicOnFlame = true, want false")
	}
}

func TestToggleVisibility_ErrorCase_NoActivePromiseReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000052"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPatch, path: "/habits/" + habit.ID + "/promise/visibility", headers: a,
		body: habits.UpdatePromiseVisibilityRequest{IsPublicOnFlame: true},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestToggleVisibility_ErrorCase_OtherUsersPromiseReturns404(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	owner := bearerFor(t, tokens, newUserID(t, "300000000053"))
	habit := createHabit(t, srv, owner, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: owner,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})

	other := bearerFor(t, tokens, newUserID(t, "300000000054"))
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPatch, path: "/habits/" + habit.ID + "/promise/visibility", headers: other,
		body: habits.UpdatePromiseVisibilityRequest{IsPublicOnFlame: true},
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestToggleVisibility_ErrorCase_MissingBodyReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000055"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodPatch, path: "/habits/" + habit.ID + "/promise/visibility", headers: a})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestToggleVisibility_ErrorCase_MalformedJSONReturns400(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000056"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30)},
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodPatch, path: "/habits/" + habit.ID + "/promise/visibility", headers: a, rawBody: "{invalid"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// TestToggleVisibility_EdgeCase_LiteralNullBodyReturnsBodyRequiredWithoutMutation
// proves a literal JSON `null` body 400s with "Request body is required"
// (ToggleVisibility's own `if (request is null) return
// BadRequest("Request body is required")` check in PromiseEndpoints.cs) —
// AND, critically, does not mutate IsPublicOnFlame at all. Before decodeJSON
// distinguished a null body from a present-but-zero-valued one, Go's
// encoding/json silently decoded `null` into a zero-valued
// UpdatePromiseVisibilityRequest{IsPublicOnFlame: false} with no error,
// which meant a null body on this endpoint returned 200 and silently
// flipped visibility to false.
func TestToggleVisibility_EdgeCase_LiteralNullBodyReturnsBodyRequiredWithoutMutation(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "300000000057"))
	habit := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/promise", headers: a,
		body: habits.CreatePromiseRequest{TargetConsistency: 70, EndDate: futureDate(30), IsPublicOnFlame: boolPtr(true)},
	})

	resp := doRequest(t, srv, testRequest{method: http.MethodPatch, path: "/habits/" + habit.ID + "/promise/visibility", headers: a, rawBody: "null"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]string](t, resp)
	if body["error"] != "Request body is required" {
		t.Errorf(`error = %q, want "Request body is required"`, body["error"])
	}

	getResp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/" + habit.ID + "/promise", headers: a})
	getBody := decodeBody[habits.GetPromiseResponse](t, getResp)
	if getBody.Active == nil || !getBody.Active.IsPublicOnFlame {
		t.Errorf("IsPublicOnFlame after a null-body PATCH = %+v, want still true (unmutated)", getBody.Active)
	}
}
