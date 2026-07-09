//go:build integration

package auth_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/export"
)

type exportResponseBody struct {
	ExportedAt string                 `json:"exportedAt"`
	Services   []export.ServiceExport `json:"services"`
	Warnings   []string               `json:"warnings"`
}

func TestExport_HappyPath_OnlyAuthSectionUntilOtherModulesRegister(t *testing.T) {
	srv, _, _ := newTestServerWithRegistries(t, 100000, 100000)
	reg := registerUser(t, srv, "export1@example.com", "exportuser1", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/export",
		headers: bearer(reg.AccessToken),
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[exportResponseBody](t, resp)
	if body.ExportedAt == "" {
		t.Error("exportedAt is empty")
	}
	if len(body.Services) != 1 || body.Services[0].Service != "auth" {
		t.Errorf("services = %+v, want exactly one auth section", body.Services)
	}
	if len(body.Warnings) != 0 {
		t.Errorf("warnings = %v, want empty", body.Warnings)
	}
}

func TestExport_HappyPath_AggregatesRegisteredSections(t *testing.T) {
	srv, _, exportRegistry := newTestServerWithRegistries(t, 100000, 100000)
	exportRegistry.Register("habits", func(_ context.Context, _ string) (any, error) {
		return map[string]any{"habits": []any{}}, nil
	})
	reg := registerUser(t, srv, "export2@example.com", "exportuser2", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/export",
		headers: bearer(reg.AccessToken),
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body := decodeBody[exportResponseBody](t, resp)
	if len(body.Services) != 2 {
		t.Fatalf("services = %+v, want 2 (auth + habits)", body.Services)
	}
}

func TestExport_HappyPath_FailingSectionBecomesAWarningNotAFailure(t *testing.T) {
	srv, _, exportRegistry := newTestServerWithRegistries(t, 100000, 100000)
	exportRegistry.Register("habits", func(_ context.Context, _ string) (any, error) {
		return nil, errors.New("habits db unreachable")
	})
	reg := registerUser(t, srv, "export3@example.com", "exportuser3", "Password123!", nil)

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/export",
		headers: bearer(reg.AccessToken),
	})

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (a section failure must not fail the whole export)", resp.StatusCode)
	}
	body := decodeBody[exportResponseBody](t, resp)
	if len(body.Services) != 1 || body.Services[0].Service != "auth" {
		t.Errorf("services = %+v, want only the auth section", body.Services)
	}
	if len(body.Warnings) != 1 {
		t.Fatalf("warnings = %v, want exactly 1", body.Warnings)
	}
}

func TestExport_ErrorCase_SecondRequestWithinWindowIsRateLimited(t *testing.T) {
	srv := newTestServer(t)
	reg := registerUser(t, srv, "export4@example.com", "exportuser4", "Password123!", nil)

	first := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/export",
		headers: bearer(reg.AccessToken),
	})
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first export status = %d, want 200", first.StatusCode)
	}

	second := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/export",
		headers: bearer(reg.AccessToken),
	})
	if second.StatusCode != http.StatusTooManyRequests {
		t.Errorf("second export within 60s: status = %d, want 429", second.StatusCode)
	}
}

func TestExport_ErrorCase_WithoutAuthReturnsUnauthorized(t *testing.T) {
	srv := newTestServer(t)

	resp := doRequest(t, srv, testRequest{method: http.MethodGet, path: "/auth/export"})

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestExport_ErrorCase_AfterAccountDeletedReturnsNotFound(t *testing.T) {
	srv := newTestServer(t)
	reg := registerUser(t, srv, "export5@example.com", "exportuser5", "Password123!", nil)

	deleteResp := doRequest(t, srv, testRequest{
		method:  http.MethodDelete,
		path:    "/auth/account",
		headers: bearer(reg.AccessToken),
	})
	if deleteResp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", deleteResp.StatusCode)
	}

	resp := doRequest(t, srv, testRequest{
		method:  http.MethodGet,
		path:    "/auth/export",
		headers: bearer(reg.AccessToken),
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}
