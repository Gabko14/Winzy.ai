//go:build integration

package auth_test

import (
	"fmt"
	"net/http"
	"net/url"
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

func TestSearchUsers_EdgeCase_LengthCheckHappensBeforeTrimming(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "spacesearcher@example.com", "spacesearcher", "Password123!", nil)
	registerUser(t, srv, "singlea@example.com", "singleamatch", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/auth/users/search?q=+a+", headers: bearer(searcher.AccessToken),
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if results := decodeBody[[]auth.UserSearchResult](t, resp); len(results) == 0 {
		t.Error(`query " a " must pass the pre-trim length check and search for "a"`)
	}
}

func TestSearchUsers_EdgeCase_OneUTF16CodeUnitStillReturnsEmpty(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "unicodesearcher@example.com", "unicodesearcher", "Password123!", nil)
	resp := doRequest(t, srv, testRequest{
		method: http.MethodGet, path: "/auth/users/search?q=%C3%A9", headers: bearer(searcher.AccessToken),
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if results := decodeBody[[]auth.UserSearchResult](t, resp); len(results) != 0 {
		t.Errorf("results = %+v, want empty for one UTF-16 code unit", results)
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

// --- ILIKE metacharacter escaping (%, _, \ must match literally) ---
//
// Usernames are restricted by validateRegistration's regex to
// [a-zA-Z0-9_-]{3,64} — they can legitimately contain "_" but never "%" or
// "\", so the "%" and "\" cases below use DisplayName (unrestricted)
// instead, and the "_" case uses Username.

func TestSearchUsers_EdgeCase_PercentSignMatchesLiterally(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "pctsearcher@example.com", "pctsearcher", "Password123!", nil)

	literal := "Discount50%Off"
	registerUser(t, srv, "pctliteral@example.com", "pctliteraluser", "Password123!", &literal)
	decoy := "DiscountFiftyOff"
	registerUser(t, srv, "pctdecoy@example.com", "pctdecoyuser", "Password123!", &decoy)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/users/search?q=" + url.QueryEscape("50%"),
		headers: bearer(searcher.AccessToken),
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	results := decodeBody[[]auth.UserSearchResult](t, resp)

	foundLiteral, foundDecoy := false, false
	for _, r := range results {
		if r.Username == "pctliteraluser" {
			foundLiteral = true
		}
		if r.Username == "pctdecoyuser" {
			foundDecoy = true
		}
	}
	if !foundLiteral {
		t.Errorf("results = %+v, want to include the user whose displayName literally contains 50%%", results)
	}
	if foundDecoy {
		t.Errorf("results = %+v, an unescaped '%%' wildcard over-matched an unrelated user with no literal '%%'", results)
	}
}

func TestSearchUsers_EdgeCase_UnderscoreMatchesLiterally(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "usearcher@example.com", "usearcher", "Password123!", nil)

	// "r_s" as an unescaped ILIKE pattern (r, any-single-char, s) would also
	// match "arms1" (substring "rms"); escaped, it must only match a
	// username with a literal underscore between an "r" and an "s".
	registerUser(t, srv, "uliteral@example.com", "under_score1", "Password123!", nil)
	registerUser(t, srv, "udecoy@example.com", "arms1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/users/search?q=r_s",
		headers: bearer(searcher.AccessToken),
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	results := decodeBody[[]auth.UserSearchResult](t, resp)

	foundLiteral, foundDecoy := false, false
	for _, r := range results {
		if r.Username == "under_score1" {
			foundLiteral = true
		}
		if r.Username == "arms1" {
			foundDecoy = true
		}
	}
	if !foundLiteral {
		t.Errorf("results = %+v, want to include under_score1 (literal 'r_s' substring)", results)
	}
	if foundDecoy {
		t.Errorf("results = %+v, an unescaped '_' wildcard over-matched arms1 (substring 'rms', no literal underscore)", results)
	}
}

func TestSearchUsers_EdgeCase_BackslashMatchesLiterally(t *testing.T) {
	srv := newTestServer(t)
	searcher := registerUser(t, srv, "bslashsearcher@example.com", "bslashsearcher", "Password123!", nil)

	literal := `Back\Slash`
	registerUser(t, srv, "bslashliteral@example.com", "bslashliteraluser", "Password123!", &literal)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/users/search?q=" + url.QueryEscape(`ck\Sl`),
		headers: bearer(searcher.AccessToken),
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	results := decodeBody[[]auth.UserSearchResult](t, resp)

	found := false
	for _, r := range results {
		if r.Username == "bslashliteraluser" {
			found = true
		}
	}
	if !found {
		t.Errorf(`results = %+v, want to include the user whose displayName literally contains a backslash`, results)
	}
}
