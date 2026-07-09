package httpserver

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
)

var uuidV4Pattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func testLogger(buf *bytes.Buffer) *slog.Logger {
	return slog.New(slog.NewJSONHandler(buf, nil))
}

// decodeLogLines parses newline-delimited JSON log records, as produced by
// slog.NewJSONHandler, into a slice of field maps.
func decodeLogLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	dec := json.NewDecoder(buf)
	var lines []map[string]any
	for dec.More() {
		var line map[string]any
		if err := dec.Decode(&line); err != nil {
			t.Fatalf("decoding log line: %v", err)
		}
		lines = append(lines, line)
	}
	return lines
}

func TestRequestLogging_HappyPath_LogsRequestIDAndFields(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)

	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusCreated)
		}),
		Recovery(logger),
		RequestLogging(logger),
	)

	req := httptest.NewRequest(http.MethodPost, "/habits", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	lines := decodeLogLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1: %v", len(lines), lines)
	}
	line := lines[0]

	requestID, _ := line["request_id"].(string)
	if !uuidV4Pattern.MatchString(requestID) {
		t.Errorf("request_id = %q, want a UUIDv4", requestID)
	}
	if line["method"] != "POST" {
		t.Errorf("method = %v, want POST", line["method"])
	}
	if line["path"] != "/habits" {
		t.Errorf("path = %v, want /habits", line["path"])
	}
	if status, _ := line["status"].(float64); status != http.StatusCreated {
		t.Errorf("status = %v, want 201", line["status"])
	}
	if _, ok := line["duration_ms"]; !ok {
		t.Error("duration_ms field missing from log line")
	}
	if _, ok := line["user_id"]; ok {
		t.Error("user_id should be absent for an unauthenticated request")
	}
}

func TestRequestLogging_EdgeCase_IncludesUserIDWhenAuthenticated(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)

	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
		Recovery(logger),
		RequestLogging(logger),
		func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				SetUserID(r.Context(), "user-123")
				next.ServeHTTP(w, r)
			})
		},
	)

	req := httptest.NewRequest(http.MethodGet, "/auth/profile", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	lines := decodeLogLines(t, &buf)
	if lines[0]["user_id"] != "user-123" {
		t.Errorf("user_id = %v, want user-123", lines[0]["user_id"])
	}
}

func TestRequestLogging_EdgeCase_DefaultsStatusTo200WhenHandlerNeverCallsWriteHeader(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)

	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte("ok"))
		}),
		Recovery(logger),
		RequestLogging(logger),
	)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	lines := decodeLogLines(t, &buf)
	if status, _ := lines[0]["status"].(float64); status != http.StatusOK {
		t.Errorf("status = %v, want 200", lines[0]["status"])
	}
}

func TestRecovery_ErrorCase_PanicIsRecoveredAndLoggedWithRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)

	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			panic("boom")
		}),
		Recovery(logger),
	)

	req := httptest.NewRequest(http.MethodGet, "/habits", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	res := rec.Result()
	if res.StatusCode != http.StatusInternalServerError {
		t.Errorf("status code = %d, want 500", res.StatusCode)
	}

	lines := decodeLogLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1: %v", len(lines), lines)
	}
	requestID, _ := lines[0]["request_id"].(string)
	if !uuidV4Pattern.MatchString(requestID) {
		t.Errorf("request_id = %q, want a UUIDv4", requestID)
	}
	if lines[0]["panic"] != "boom" {
		t.Errorf("panic field = %v, want boom", lines[0]["panic"])
	}
}

func TestRecovery_HappyPath_SetsRequestIDResponseHeader(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)

	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
		Recovery(logger),
	)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if id := rec.Header().Get("X-Request-Id"); !uuidV4Pattern.MatchString(id) {
		t.Errorf("X-Request-Id header = %q, want a UUIDv4", id)
	}
}

func TestCORS_HappyPath_AllowedOriginIsEchoedWithCredentials(t *testing.T) {
	handler := CORS("http://localhost:8081")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "http://localhost:8081")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:8081" {
		t.Errorf("Access-Control-Allow-Origin = %q, want http://localhost:8081", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Access-Control-Allow-Credentials = %q, want true", got)
	}
}

func TestCORS_EdgeCase_DisallowedOriginGetsNoAccessControlHeader(t *testing.T) {
	handler := CORS("http://localhost:8081")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Access-Control-Allow-Origin = %q, want empty for disallowed origin", got)
	}
}

func TestCORS_EdgeCase_PreflightOptionsShortCircuits(t *testing.T) {
	called := false
	handler := CORS("http://localhost:8081")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))

	req := httptest.NewRequest(http.MethodOptions, "/habits", nil)
	req.Header.Set("Origin", "http://localhost:8081")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if called {
		t.Error("preflight OPTIONS request should not reach the wrapped handler")
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("status code = %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Error("Access-Control-Allow-Methods header missing on preflight response")
	}
}
