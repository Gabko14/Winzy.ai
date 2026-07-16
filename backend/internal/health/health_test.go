package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakePinger struct {
	err error
}

func (f fakePinger) Ping(ctx context.Context) error {
	return f.err
}

func doRequest(t *testing.T, db Pinger) (*http.Response, response) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	Handler(db).ServeHTTP(rec, req)

	res := rec.Result()
	var body response
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decoding response body: %v", err)
	}
	return res, body
}

func TestHandler_HappyPath_DBUpReturns200Healthy(t *testing.T) {
	t.Parallel()
	res, body := doRequest(t, fakePinger{})

	if res.StatusCode != http.StatusOK {
		t.Errorf("status code = %d, want 200", res.StatusCode)
	}
	if body.Status != "healthy" || body.DB != "up" {
		t.Errorf("body = %+v, want {healthy up}", body)
	}
}

func TestHandler_ErrorCase_DBDownReturns503Unhealthy(t *testing.T) {
	t.Parallel()
	res, body := doRequest(t, fakePinger{err: errors.New("connection refused")})

	if res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status code = %d, want 503", res.StatusCode)
	}
	if body.Status != "unhealthy" || body.DB != "down" {
		t.Errorf("body = %+v, want {unhealthy down}", body)
	}
}

func TestHandler_EdgeCase_ResponseIsJSONContentType(t *testing.T) {
	t.Parallel()
	res, _ := doRequest(t, fakePinger{})

	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}
