//go:build integration

package habits_test

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

func TestOrderHabits_HappyPath_PersistsAcrossListAndRange(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000001"))
	h1 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "First"})
	h2 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Second"})
	h3 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Third"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/order", headers: a,
		body: habits.OrderHabitsRequest{HabitIDs: []string{h3.ID, h1.ID, h2.ID}},
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order status = %d, want 204", resp.StatusCode)
	}

	listResp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits", headers: a})
	list := decodeBody[[]habits.HabitResponse](t, listResp)
	if len(list) != 3 || list[0].ID != h3.ID || list[1].ID != h1.ID || list[2].ID != h2.ID {
		t.Fatalf("list order = %+v, want [Third, First, Second]", list)
	}
	if list[0].Position != 0 || list[1].Position != 1 || list[2].Position != 2 {
		t.Errorf("positions = %d,%d,%d want 0,1,2", list[0].Position, list[1].Position, list[2].Position)
	}

	today := time.Now().UTC().Format("2006-01-02")
	rangeResp := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/habits/completions?from=" + today + "&to=" + today, headers: a,
	})
	rangeBody := decodeBody[habits.CompletionsRangeResponse](t, rangeResp)
	if len(rangeBody.Habits) != 3 || rangeBody.Habits[0].ID != h3.ID || rangeBody.Habits[1].ID != h1.ID || rangeBody.Habits[2].ID != h2.ID {
		t.Fatalf("range order = %+v, want lockstep with list", rangeBody.Habits)
	}
}

func TestOrderHabits_HappyPath_PublicFlameReflectsOrder(t *testing.T) {
	t.Parallel()
	srv, tokens, _, authService, _ := newTestServerWithAuth(t)
	username := "orderflame1"
	reg := registerUserViaService(t, authService, "orderflame1@example.com", username)
	a := bearerFor(t, tokens, reg.User.ID)
	h1 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Alpha"})
	h2 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Beta"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/order", headers: a,
		body: habits.OrderHabitsRequest{HabitIDs: []string{h2.ID, h1.ID}},
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("order status = %d, want 204", resp.StatusCode)
	}

	pub := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits/public/" + username})
	if pub.StatusCode != http.StatusOK {
		t.Fatalf("public status = %d, want 200", pub.StatusCode)
	}
	body := decodeBody[habits.PublicFlameProfileResponse](t, pub)
	if len(body.Habits) != 2 || body.Habits[0].Name != "Beta" || body.Habits[1].Name != "Alpha" {
		t.Fatalf("public habits = %+v, want [Beta, Alpha]", body.Habits)
	}
}

func TestOrderHabits_EdgeCase_SingleHabit(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000002"))
	h1 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Only"})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/order", headers: a,
		body: habits.OrderHabitsRequest{HabitIDs: []string{h1.ID}},
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}
}

func TestOrderHabits_EdgeCase_ArchiveThenReorderRemaining(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000003"))
	h1 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "KeepA"})
	archived := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "Gone"})
	h3 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "KeepB"})
	doRequest(t, srv, testRequest{method: http.MethodDelete, path: "/habits/" + archived.ID, headers: a})

	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/order", headers: a,
		body: habits.OrderHabitsRequest{HabitIDs: []string{h3.ID, h1.ID}},
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}
	list := decodeBody[[]habits.HabitResponse](t, doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits", headers: a}))
	if len(list) != 2 || list[0].ID != h3.ID || list[1].ID != h1.ID {
		t.Fatalf("list = %+v, want [KeepB, KeepA]", list)
	}
}

func TestOrderHabits_EdgeCase_CreateAfterReorderAppendsAtEnd(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000004"))
	h1 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "A"})
	h2 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "B"})
	doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/order", headers: a,
		body: habits.OrderHabitsRequest{HabitIDs: []string{h2.ID, h1.ID}},
	})

	h3 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "C"})
	if h3.Position != 2 {
		t.Errorf("new habit position = %d, want 2 (append at end)", h3.Position)
	}
	list := decodeBody[[]habits.HabitResponse](t, doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits", headers: a}))
	if len(list) != 3 || list[2].ID != h3.ID {
		t.Fatalf("list = %+v, want C at end", list)
	}
}

func TestOrderHabits_EdgeCase_ConcurrentReordersLastWriteWins(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000005"))
	h1 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "A"})
	h2 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "B"})
	h3 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "C"})

	orders := [][]string{
		{h1.ID, h2.ID, h3.ID},
		{h3.ID, h2.ID, h1.ID},
	}
	var wg sync.WaitGroup
	errs := make(chan int, 2)
	for _, ids := range orders {
		wg.Add(1)
		go func(ids []string) {
			defer wg.Done()
			resp := doRequest(t, srv, testRequest{
				method: http.MethodPut, path: "/habits/order", headers: a,
				body: habits.OrderHabitsRequest{HabitIDs: ids},
			})
			errs <- resp.StatusCode
		}(ids)
	}
	wg.Wait()
	close(errs)
	for code := range errs {
		if code != http.StatusNoContent {
			t.Errorf("concurrent order status = %d, want 204 (no constraint errors)", code)
		}
	}
	list := decodeBody[[]habits.HabitResponse](t, doRequest(t, srv, testRequest{method: http.MethodGet, path: "/habits", headers: a}))
	if len(list) != 3 {
		t.Fatalf("list len = %d after concurrent reorder", len(list))
	}
	seen := map[int]bool{}
	for _, h := range list {
		if seen[h.Position] {
			t.Errorf("duplicate position %d after concurrent reorder", h.Position)
		}
		seen[h.Position] = true
	}
}

func TestOrderHabits_ErrorCase_MissingExtraDuplicateForeign(t *testing.T) {
	t.Parallel()
	srv, tokens, _ := newTestServer(t)
	a := bearerFor(t, tokens, newUserID(t, "200000000006"))
	other := bearerFor(t, tokens, newUserID(t, "200000000007"))
	h1 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "A"})
	h2 := createHabit(t, srv, a, habits.CreateHabitRequest{Name: "B"})
	foreign := createHabit(t, srv, other, habits.CreateHabitRequest{Name: "Other"})

	cases := []struct {
		name string
		ids  []string
	}{
		{"missing", []string{h1.ID}},
		{"extra unknown", []string{h1.ID, h2.ID, "11111111-1111-4111-8111-111111111111"}},
		{"duplicate", []string{h1.ID, h1.ID}},
		{"foreign", []string{h1.ID, foreign.ID}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := doRequest(t, srv, testRequest{
				method: http.MethodPut, path: "/habits/order", headers: a,
				body: habits.OrderHabitsRequest{HabitIDs: tc.ids},
			})
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", resp.StatusCode)
			}
			body := decodeBody[map[string]string](t, resp)
			if body["error"] == "" {
				t.Error(`400 should include "error"`)
			}
		})
	}
}

func TestOrderHabits_ErrorCase_UnauthenticatedReturns401(t *testing.T) {
	t.Parallel()
	srv, _, _ := newTestServer(t)
	resp := doRequest(t, srv, testRequest{
		method: http.MethodPut, path: "/habits/order",
		body: habits.OrderHabitsRequest{HabitIDs: []string{}},
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}
