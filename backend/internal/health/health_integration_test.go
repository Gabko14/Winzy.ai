//go:build integration

package health_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/dbtest"
	"github.com/Gabko14/winzy/backend/internal/health"
)

// TestHandler_Integration_RealPostgres is the sample integration test the
// PM REVIEW ADDENDUM asks for: it exercises health.Handler against the
// compose "winzy-db" Postgres via TEST_DATABASE_URL (see internal/dbtest),
// proving the documented recipe actually works end-to-end. Every later
// module bead's integration tests follow this same shape.
func TestHandler_Integration_RealPostgres(t *testing.T) {
	pool := dbtest.Connect(t)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	health.Handler(pool).ServeHTTP(rec, req)

	res := rec.Result()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status code = %d, want 200", res.StatusCode)
	}

	var body struct {
		Status string `json:"status"`
		DB     string `json:"db"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decoding response body: %v", err)
	}
	if body.Status != "healthy" || body.DB != "up" {
		t.Fatalf("body = %+v, want {healthy up}", body)
	}
}
