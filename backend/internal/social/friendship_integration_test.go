//go:build integration

package social_test

import (
	"net/http"
	"sync"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

// createFriendship sends a and accepts it from b, returning the accept
// response's decoded body — the common setup step nearly every non-request
// test needs, matching FriendshipEndpointTests.cs's private CreateFriendship
// helper.
func createFriendship(t *testing.T, stack testStack, a, b string) {
	t.Helper()
	aAuth := bearerFor(t, stack.tokens, a)
	bAuth := bearerFor(t, stack.tokens, b)

	sendResp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPost, path: "/social/friends/request", headers: aAuth,
		body: map[string]string{"friendId": b},
	})
	if sendResp.StatusCode != http.StatusCreated {
		t.Fatalf("send friend request status = %d, want 201", sendResp.StatusCode)
	}
	sendBody := decodeBody[map[string]any](t, sendResp)
	requestID := sendBody["id"].(string)

	acceptResp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPut, path: "/social/friends/request/" + requestID + "/accept", headers: bAuth,
		body: map[string]any{},
	})
	if acceptResp.StatusCode != http.StatusOK {
		t.Fatalf("accept friend request status = %d, want 200", acceptResp.StatusCode)
	}
}

// --- POST /social/friends/request ---

func TestSendFriendRequest_HappyPath_Returns201(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)

	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPost, path: "/social/friends/request", headers: a,
		body: map[string]string{"friendId": friendID},
	})

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["userId"] != userID || body["friendId"] != friendID || body["status"] != "pending" {
		t.Errorf("body = %+v, want userId/friendId/status=pending", body)
	}
}

func TestSendFriendRequest_ErrorCase_MissingAuthReturns401(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPost, path: "/social/friends/request",
		body: map[string]string{"friendId": "22222222-2222-2222-2222-222222222222"},
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 (no bearer token)", resp.StatusCode)
	}
}

func TestSendFriendRequest_ErrorCase_ToSelfReturns400(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID := "11111111-1111-1111-1111-111111111111"
	a := bearerFor(t, stack.tokens, userID)

	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPost, path: "/social/friends/request", headers: a,
		body: map[string]string{"friendId": userID},
	})

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["error"] != "Cannot send friend request to yourself" {
		t.Errorf("error = %q, want the verbatim C# message", body["error"])
	}
}

func TestSendFriendRequest_EdgeCase_EmptyFriendIdReturns400(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{
		method: http.MethodPost, path: "/social/friends/request", headers: a,
		body: map[string]string{"friendId": "00000000-0000-0000-0000-000000000000"},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestSendFriendRequest_ErrorCase_DuplicateReturns409(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)

	doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})

	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["error"] != "Friend request already exists" {
		t.Errorf("error = %q, want the verbatim C# message", body["error"])
	}
}

func TestSendFriendRequest_ErrorCase_AlreadyFriendsReturns409(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})

	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["error"] != "Already friends" {
		t.Errorf("error = %q, want the verbatim C# message", body["error"])
	}
}

func TestSendFriendRequest_ErrorCase_MalformedJSONReturns400(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, rawBody: "not valid json"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if body["error"] != "Invalid JSON in request body" {
		t.Errorf("error = %q, want the verbatim C# message", body["error"])
	}
}

// --- PUT /social/friends/request/{id}/accept ---

func TestAcceptFriendRequest_HappyPath_CreatesBidirectionalFriendship(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	forward, err := stack.socialService.AreFriends(t.Context(), userID, friendID)
	if err != nil {
		t.Fatalf("AreFriends() error = %v", err)
	}
	reverse, err := stack.socialService.AreFriends(t.Context(), friendID, userID)
	if err != nil {
		t.Fatalf("AreFriends() error = %v", err)
	}
	if !forward || !reverse {
		t.Errorf("AreFriends forward=%v reverse=%v, want both true", forward, reverse)
	}
}

func TestAcceptFriendRequest_ErrorCase_WrongUserReturns404(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)

	sendResp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})
	sendBody := decodeBody[map[string]any](t, sendResp)
	requestID := sendBody["id"].(string)

	// Sender tries to accept their own request.
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/friends/request/" + requestID + "/accept", headers: a, body: map[string]any{}})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestAcceptFriendRequest_ErrorCase_NonExistentReturns404(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "22222222-2222-2222-2222-222222222222")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/friends/request/33333333-3333-3333-3333-333333333333/accept", headers: a, body: map[string]any{}})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// FIX 1 (winzy.ai-rdc7.4 review): the forward UPDATE + reverse INSERT now
// commit as one transaction, and a reverse-insert unique-violation (a lost
// race against a concurrent accept of the SAME request) maps to a
// deterministic ErrNotFound rather than an unhandled 500. Two concurrent
// accepts of the same pending request must resolve to exactly one 200 and
// one 404 — never a 500 from either.
func TestAcceptFriendRequest_EdgeCase_ConcurrentAcceptNeverProduces500(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)
	b := bearerFor(t, stack.tokens, friendID)

	sendResp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})
	sendBody := decodeBody[map[string]any](t, sendResp)
	requestID := sendBody["id"].(string)

	const attempts = 5
	statuses := make([]int, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			resp := doRequest(t, stack.srv, testRequest{
				method: http.MethodPut, path: "/social/friends/request/" + requestID + "/accept", headers: b, body: map[string]any{},
			})
			statuses[i] = resp.StatusCode
		}(i)
	}
	wg.Wait()

	successCount := 0
	for _, status := range statuses {
		switch status {
		case http.StatusOK:
			successCount++
		case http.StatusNotFound:
			// Expected for every loser of the race.
		default:
			t.Errorf("concurrent accept status = %d, want 200 or 404 — never anything else (especially not 500)", status)
		}
	}
	if successCount != 1 {
		t.Errorf("successCount = %d across %d concurrent accepts, want exactly 1", successCount, attempts)
	}
}

// --- PUT /social/friends/request/{id}/decline ---

func TestDeclineFriendRequest_HappyPath_Returns204(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)
	b := bearerFor(t, stack.tokens, friendID)

	sendResp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})
	sendBody := decodeBody[map[string]any](t, sendResp)
	requestID := sendBody["id"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/friends/request/" + requestID + "/decline", headers: b, body: map[string]any{}})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}

	// Accepting the same (now-deleted) request afterward must 404.
	acceptResp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/friends/request/" + requestID + "/accept", headers: b, body: map[string]any{}})
	if acceptResp.StatusCode != http.StatusNotFound {
		t.Errorf("accepting a declined request status = %d, want 404", acceptResp.StatusCode)
	}
}

func TestDeclineFriendRequest_ErrorCase_SenderCannotDeclineReturns404(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)

	sendResp := doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})
	sendBody := decodeBody[map[string]any](t, sendResp)
	requestID := sendBody["id"].(string)

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/friends/request/" + requestID + "/decline", headers: a, body: map[string]any{}})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// --- DELETE /social/friends/{friendId} ---

func TestRemoveFriend_HappyPath_RemovesBothDirections(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/friends/" + friendID, headers: a})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}

	forward, err := stack.socialService.AreFriends(t.Context(), userID, friendID)
	if err != nil {
		t.Fatalf("AreFriends() error = %v", err)
	}
	reverse, err := stack.socialService.AreFriends(t.Context(), friendID, userID)
	if err != nil {
		t.Fatalf("AreFriends() error = %v", err)
	}
	if forward || reverse {
		t.Errorf("AreFriends forward=%v reverse=%v after removal, want both false", forward, reverse)
	}
}

func TestRemoveFriend_ErrorCase_NotFriendsReturns404(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodDelete, path: "/social/friends/33333333-3333-3333-3333-333333333333", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// --- GET /social/friends ---

func TestListFriends_HappyPath_ReturnsPaginatedFriends(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends", headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	if int(body["total"].(float64)) != 1 {
		t.Errorf("total = %v, want 1", body["total"])
	}
	items := body["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["friendId"] != friendID {
		t.Errorf("items = %+v, want exactly one entry for %s", items, friendID)
	}
}

func TestListFriends_HappyPath_EnrichesWithProfileData(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID := "11111111-1111-1111-1111-111111111111"
	friend := registerUserViaService(t, stack.authService, "alice@example.com", "alice")
	createFriendship(t, stack, userID, friend.User.ID)

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends", headers: a})
	body := decodeBody[map[string]any](t, resp)
	item := body["items"].([]any)[0].(map[string]any)
	if item["username"] != "alice" {
		t.Errorf("username = %v, want alice", item["username"])
	}
}

func TestListFriends_EdgeCase_GracefulDegradationWhenNoProfile(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends", headers: a})
	body := decodeBody[map[string]any](t, resp)
	item := body["items"].([]any)[0].(map[string]any)
	if item["username"] != nil {
		t.Errorf("username = %v, want nil for an unregistered friend id", item["username"])
	}
}

func TestListFriends_EdgeCase_EmptyReturnsEmptyList(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if int(body["total"].(float64)) != 0 || len(body["items"].([]any)) != 0 {
		t.Errorf("body = %+v, want empty", body)
	}
}

func TestListFriends_EdgeCase_PendingRequestNotIncluded(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if int(body["total"].(float64)) != 0 {
		t.Errorf("total = %v, want 0 (pending request should not count)", body["total"])
	}
}

func TestListFriends_HappyPath_EnrichesWithFlameData(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	fAuth := bearerFor(t, stack.tokens, friendID)
	habit := createHabit(t, stack.srv, fAuth, habits.CreateHabitRequest{Name: "Meditate"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: fAuth, body: map[string]string{"visibility": "friends"}})
	doRequest(t, stack.srv, testRequest{
		method: http.MethodPost, path: "/habits/" + habit.ID + "/complete", headers: fAuth,
		body: habits.CompleteHabitRequest{Timezone: "UTC"},
	})

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends", headers: a})
	body := decodeBody[map[string]any](t, resp)
	item := body["items"].([]any)[0].(map[string]any)
	if item["flameLevel"] == "none" {
		t.Errorf("flameLevel = %v, want a non-none level after a completion", item["flameLevel"])
	}
	if item["habitsUnavailable"] != false {
		t.Errorf("habitsUnavailable = %v, want false", item["habitsUnavailable"])
	}
}

func TestListFriends_EdgeCase_NoVisibleHabitsReturnsNoneFlame(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	fAuth := bearerFor(t, stack.tokens, friendID)
	// Habit created but left at the default (Private) visibility.
	createHabit(t, stack.srv, fAuth, habits.CreateHabitRequest{Name: "Secret"})

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends", headers: a})
	body := decodeBody[map[string]any](t, resp)
	item := body["items"].([]any)[0].(map[string]any)
	if item["flameLevel"] != "none" {
		t.Errorf("flameLevel = %v, want none (habit stayed private)", item["flameLevel"])
	}
	if item["consistency"] != 0.0 {
		t.Errorf("consistency = %v, want 0", item["consistency"])
	}
}

// --- GET /social/friends/requests/count ---

func TestPendingFriendCount_EdgeCase_NoPendingReturnsZero(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/requests/count", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if int(body["count"].(float64)) != 0 {
		t.Errorf("count = %v, want 0", body["count"])
	}
}

func TestPendingFriendCount_HappyPath_WithIncomingReturnsCount(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})

	b := bearerFor(t, stack.tokens, friendID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/requests/count", headers: b})
	body := decodeBody[map[string]any](t, resp)
	if int(body["count"].(float64)) != 1 {
		t.Errorf("count = %v, want 1", body["count"])
	}
}

func TestPendingFriendCount_EdgeCase_OutgoingNotCounted(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/requests/count", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if int(body["count"].(float64)) != 0 {
		t.Errorf("count = %v, want 0 (outgoing shouldn't count)", body["count"])
	}
}

func TestPendingFriendCount_EdgeCase_AcceptedNotCounted(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	b := bearerFor(t, stack.tokens, friendID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/requests/count", headers: b})
	body := decodeBody[map[string]any](t, resp)
	if int(body["count"].(float64)) != 0 {
		t.Errorf("count = %v, want 0 after acceptance", body["count"])
	}
}

func TestPendingFriendCount_ErrorCase_MissingAuthReturns401(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/requests/count"})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

// --- GET /social/friends/requests ---

func TestListFriendRequests_HappyPath_ShowsIncomingAndOutgoing(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	a := bearerFor(t, stack.tokens, userID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": friendID}})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/requests", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if len(body["outgoing"].([]any)) != 1 || len(body["incoming"].([]any)) != 0 {
		t.Errorf("sender view = %+v, want 1 outgoing / 0 incoming", body)
	}

	b := bearerFor(t, stack.tokens, friendID)
	friendResp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/requests", headers: b})
	friendBody := decodeBody[map[string]any](t, friendResp)
	if len(friendBody["outgoing"].([]any)) != 0 || len(friendBody["incoming"].([]any)) != 1 {
		t.Errorf("recipient view = %+v, want 0 outgoing / 1 incoming", friendBody)
	}
}

func TestListFriendRequests_HappyPath_EnrichesWithProfileData(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	sender := registerUserViaService(t, stack.authService, "sender@example.com", "sender")
	receiver := registerUserViaService(t, stack.authService, "receiver@example.com", "receiver")

	a := bearerFor(t, stack.tokens, sender.User.ID)
	doRequest(t, stack.srv, testRequest{method: http.MethodPost, path: "/social/friends/request", headers: a, body: map[string]string{"friendId": receiver.User.ID}})

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/requests", headers: a})
	body := decodeBody[map[string]any](t, resp)
	outgoing := body["outgoing"].([]any)[0].(map[string]any)
	if outgoing["toUsername"] != "receiver" {
		t.Errorf("toUsername = %v, want receiver", outgoing["toUsername"])
	}

	b := bearerFor(t, stack.tokens, receiver.User.ID)
	friendResp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/requests", headers: b})
	friendBody := decodeBody[map[string]any](t, friendResp)
	incoming := friendBody["incoming"].([]any)[0].(map[string]any)
	if incoming["fromUsername"] != "sender" {
		t.Errorf("fromUsername = %v, want sender", incoming["fromUsername"])
	}
}

// --- GET /social/friends/{id}/profile ---

func TestFriendProfile_HappyPath_ReturnsVisibleHabits(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	fAuth := bearerFor(t, stack.tokens, friendID)
	habit := createHabit(t, stack.srv, fAuth, habits.CreateHabitRequest{Name: "Meditate"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + habit.ID, headers: fAuth, body: map[string]string{"visibility": "friends"}})

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/" + friendID + "/profile", headers: a})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[map[string]any](t, resp)
	habitsOut := body["habits"].([]any)
	if len(habitsOut) != 1 {
		t.Fatalf("habits = %+v, want exactly 1 (the visible one)", habitsOut)
	}
}

func TestFriendProfile_EdgeCase_EmptyHabitsReturnsAvailable(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/" + friendID + "/profile", headers: a})
	body := decodeBody[map[string]any](t, resp)
	if len(body["habits"].([]any)) != 0 || body["habitsUnavailable"] != false {
		t.Errorf("body = %+v, want empty habits, habitsUnavailable=false", body)
	}
}

func TestFriendProfile_ErrorCase_NotFriendsReturns404(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := bearerFor(t, stack.tokens, "11111111-1111-1111-1111-111111111111")

	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/22222222-2222-2222-2222-222222222222/profile", headers: a})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestFriendProfile_PerHabitOverridesDefault(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	userID, friendID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	createFriendship(t, stack, userID, friendID)

	fAuth := bearerFor(t, stack.tokens, friendID)
	// Preference set to "friends" BEFORE either habit is created: the
	// HabitCreated hook eagerly materializes each habit's visibility_settings
	// row at whatever the owner's default is AT CREATION TIME (see
	// service.go's handleHabitCreated), so h1 must be created after this to
	// pick up "friends" as its starting (default-derived) value.
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/preferences", headers: fAuth, body: map[string]string{"defaultHabitVisibility": "friends"}})
	h1 := createHabit(t, stack.srv, fAuth, habits.CreateHabitRequest{Name: "Workout"})
	h2 := createHabit(t, stack.srv, fAuth, habits.CreateHabitRequest{Name: "Reading"})
	doRequest(t, stack.srv, testRequest{method: http.MethodPut, path: "/social/visibility/" + h2.ID, headers: fAuth, body: map[string]string{"visibility": "private"}})

	a := bearerFor(t, stack.tokens, userID)
	resp := doRequest(t, stack.srv, testRequest{method: http.MethodGet, path: "/social/friends/" + friendID + "/profile", headers: a})
	body := decodeBody[map[string]any](t, resp)
	habitsOut := body["habits"].([]any)
	if len(habitsOut) != 1 {
		t.Fatalf("habits = %+v, want exactly 1 (h1 via default, h2 excluded by explicit private)", habitsOut)
	}
	if habitsOut[0].(map[string]any)["name"] != "Workout" {
		t.Errorf("visible habit = %+v, want Workout", habitsOut[0])
	}
	_ = h1
}
