//go:build integration

package auth_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestSearchUsers_HappyPath_ByUsernameReturnsMatches(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "searcher1@example.com", "searcher1", "Password123!", nil)
	registerUser(t, srv, "search1@example.com", "searchable1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/users/search?q=searchable",
		headers: bearer(searcher.AccessToken),
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	results := decodeBody[[]auth.UserSearchResult](t, resp)
	found := false
	for _, r := range results {
		if r.Username == "searchable1" {
			found = true
		}
	}
	if !found {
		t.Errorf("results = %+v, want to include searchable1", results)
	}
}

func TestSearchUsers_HappyPath_ByDisplayNameReturnsMatches(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "searcher2@example.com", "searcher2", "Password123!", nil)
	displayName := "FindableUser"
	registerUser(t, srv, "search2@example.com", "searchdn1", "Password123!", &displayName)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/users/search?q=findable",
		headers: bearer(searcher.AccessToken),
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	results := decodeBody[[]auth.UserSearchResult](t, resp)
	found := false
	for _, r := range results {
		if r.DisplayName != nil && *r.DisplayName == "FindableUser" {
			found = true
		}
	}
	if !found {
		t.Errorf("results = %+v, want to include a result with DisplayName FindableUser", results)
	}
}

func TestSearchUsers_EdgeCase_ShortQueryReturnsEmpty(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "searcher3@example.com", "searcher3", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/users/search?q=a",
		headers: bearer(searcher.AccessToken),
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	results := decodeBody[[]auth.UserSearchResult](t, resp)
	if len(results) != 0 {
		t.Errorf("results = %+v, want empty for a 1-char query", results)
	}
}

func TestSearchUsers_EdgeCase_NoQueryReturnsEmpty(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "searcher4@example.com", "searcher4", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/users/search",
		headers: bearer(searcher.AccessToken),
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	results := decodeBody[[]auth.UserSearchResult](t, resp)
	if len(results) != 0 {
		t.Errorf("results = %+v, want empty with no q param", results)
	}
}

func TestSearchUsers_EdgeCase_LimitsResultsTo20(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "searcher5@example.com", "searcher5", "Password123!", nil)

	for i := 0; i < 25; i++ {
		registerUser(t, srv, fmt.Sprintf("bulk%d@example.com", i), fmt.Sprintf("bulkuser%03d", i), "Password123!", nil)
	}

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/users/search?q=bulkuser",
		headers: bearer(searcher.AccessToken),
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	results := decodeBody[[]auth.UserSearchResult](t, resp)
	if len(results) > 20 {
		t.Errorf("len(results) = %d, want <= 20", len(results))
	}
}

func TestSearchUsers_ErrorCase_NoMatchReturnsEmpty(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "searcher6@example.com", "searcher6", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/users/search?q=zzzznonexistent",
		headers: bearer(searcher.AccessToken),
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	results := decodeBody[[]auth.UserSearchResult](t, resp)
	if len(results) != 0 {
		t.Errorf("results = %+v, want empty", results)
	}
}

func TestSearchUsers_ErrorCase_WithoutAuthReturnsUnauthorized(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/auth/users/search?q=anything"})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}
