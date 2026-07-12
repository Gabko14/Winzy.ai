package httpserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
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

func TestRequestLogging_EdgeCase_RedactsSensitivePathPrefix(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)

	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
		Recovery(logger),
		RequestLogging(logger, "/social/witness/"),
	)

	token := "AbCdEf0123456789AbCdEf0123456789AbCdEf01234"
	req := httptest.NewRequest(http.MethodGet, "/social/witness/"+token, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	lines := decodeLogLines(t, &buf)
	path, _ := lines[0]["path"].(string)
	if strings.Contains(path, token) {
		t.Errorf("logged path = %q, want the token redacted (it must never reach stdout/Railway logs)", path)
	}
	if path != "/social/witness/[redacted]" {
		t.Errorf("logged path = %q, want \"/social/witness/[redacted]\"", path)
	}
}

func TestRequestLogging_EdgeCase_NonSensitivePathIsUnaffected(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)

	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
		Recovery(logger),
		RequestLogging(logger, "/social/witness/"),
	)

	req := httptest.NewRequest(http.MethodGet, "/habits", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	lines := decodeLogLines(t, &buf)
	if lines[0]["path"] != "/habits" {
		t.Errorf("logged path = %v, want /habits unaffected by an unrelated sensitive prefix", lines[0]["path"])
	}
}

func TestRequestLogging_EdgeCase_NoSensitivePrefixesLeavesPathUnchanged(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)

	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
		Recovery(logger),
		RequestLogging(logger), // no sensitive prefixes at all — the pre-FIX-15 call shape.
	)

	req := httptest.NewRequest(http.MethodGet, "/social/witness/some-token", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	lines := decodeLogLines(t, &buf)
	if lines[0]["path"] != "/social/witness/some-token" {
		t.Errorf("logged path = %v, want unredacted when no sensitive prefixes are configured", lines[0]["path"])
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

// TestRecovery_ErrorCase_RedactsSensitivePathOnPanic closes the residual
// flagged after FIX 15 (winzy.ai-rdc7.4 review): a panic mid-request on a
// witness route must not leak the token into the panic log line either — a
// crash is exactly the moment someone is reading logs.
func TestRecovery_ErrorCase_RedactsSensitivePathOnPanic(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)

	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			panic("boom")
		}),
		Recovery(logger, "/social/witness/"),
	)

	token := "AbCdEf0123456789AbCdEf0123456789AbCdEf01234"
	req := httptest.NewRequest(http.MethodGet, "/social/witness/"+token, nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("status code = %d, want 500", rec.Result().StatusCode)
	}

	lines := decodeLogLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1: %v", len(lines), lines)
	}
	path, _ := lines[0]["path"].(string)
	if strings.Contains(path, token) {
		t.Errorf("panic log path = %q, want the token redacted", path)
	}
	if path != "/social/witness/[redacted]" {
		t.Errorf("panic log path = %q, want \"/social/witness/[redacted]\"", path)
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

func TestRecovery_ErrorCase_PanicStillEmitsCompleteRequestLog(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)
	handler := Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	}), RequestID(), RequestLogging(logger), Recovery(logger))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/panic", nil))
	lines := decodeLogLines(t, &buf)
	if len(lines) != 2 {
		t.Fatalf("got %d log lines, want panic + request: %v", len(lines), lines)
	}
	var requestLine map[string]any
	for _, line := range lines {
		if line["msg"] == "request" {
			requestLine = line
		}
	}
	if requestLine == nil {
		t.Fatal("complete request log line missing")
	}
	if status, _ := requestLine["status"].(float64); status != http.StatusInternalServerError {
		t.Errorf("request log status = %v, want 500", requestLine["status"])
	}
	if _, ok := requestLine["duration_ms"]; !ok {
		t.Error("request log duration_ms missing")
	}
}

func TestRecovery_EdgeCase_PanicAfterWriteKeepsCommittedStatus(t *testing.T) {
	var buf bytes.Buffer
	logger := testLogger(&buf)
	handler := Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("partial"))
		panic("late")
	}), RequestID(), RequestLogging(logger), Recovery(logger))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/panic", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("committed status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != `partial{"error":"internal server error"}` {
		t.Errorf("body = %q, want documented appended recovery body", rec.Body.String())
	}
	for _, line := range decodeLogLines(t, &buf) {
		if line["msg"] == "request" {
			if status, _ := line["status"].(float64); status != http.StatusOK {
				t.Errorf("request log status = %v, want committed 200", line["status"])
			}
		}
	}
}

func TestBodyLimit_HappyPath_ExactLimitReachesHandler(t *testing.T) {
	called := false
	handler := BodyLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(strings.Repeat("a", int(maxRequestBodyBytes))))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if !called || rec.Code != http.StatusNoContent {
		t.Errorf("called/status = %v/%d, want true/204", called, rec.Code)
	}
}

func TestBodyLimit_ErrorCase_OversizedBodyReturnsEmpty413(t *testing.T) {
	called := false
	handler := BodyLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	req := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(strings.Repeat("a", int(maxRequestBodyBytes+1))))
	req.ContentLength = -1 // exercise the bounded-read path, not just the header shortcut
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if called || rec.Code != http.StatusRequestEntityTooLarge || rec.Body.Len() != 0 {
		t.Errorf("called/status/body = %v/%d/%q, want false/413/empty", called, rec.Code, rec.Body.String())
	}
}

// erroringBody is an io.ReadCloser that fails if actually read, used to
// prove BodyLimit does not eagerly buffer bodyless methods: if it did, the
// read would surface this error as a 400.
type erroringBody struct{}

func (erroringBody) Read([]byte) (int, error) {
	return 0, errors.New("body must not be read for this method")
}
func (erroringBody) Close() error { return nil }

// TestBodyLimit_HappyPath_NonBodyCarryingMethodIsNotEagerlyBuffered closes
// FIX A (winzy.ai-n5fv review round 1): GET/DELETE/HEAD/OPTIONS never carry
// a JSON body in this API, so BodyLimit must only lazily wrap them in
// http.MaxBytesReader instead of eagerly reading up to 1 MiB per request.
func TestBodyLimit_HappyPath_NonBodyCarryingMethodIsNotEagerlyBuffered(t *testing.T) {
	called := false
	handler := BodyLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Body = erroringBody{}
	req.ContentLength = -1
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if !called || rec.Code != http.StatusOK {
		t.Errorf("called/status = %v/%d, want true/200 (GET body must not be eagerly read)", called, rec.Code)
	}
}

// TestBodyLimit_ErrorCase_OversizedBodyKeepsCORSHeadersWhenInsideCORS closes
// the other half of FIX A: BodyLimit must run inside CORS (see
// cmd/api/main.go's wiring — CORS wraps the rate limiter which wraps
// BodyLimit) so a 413 still carries CORS headers for the Expo-dev origin.
func TestBodyLimit_ErrorCase_OversizedBodyKeepsCORSHeadersWhenInsideCORS(t *testing.T) {
	handler := CORS("http://localhost:8081")(BodyLimit()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be reached for an oversized body")
	})))
	req := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(strings.Repeat("a", int(maxRequestBodyBytes+1))))
	req.ContentLength = -1 // exercise the bounded-read path, not just the header shortcut
	req.Header.Set("Origin", "http://localhost:8081")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:8081" {
		t.Errorf("Access-Control-Allow-Origin = %q, want it preserved on a 413", got)
	}
}

func TestNew_HappyPath_ConfiguresServerTimeouts(t *testing.T) {
	srv := New(8080, "http://localhost:8081", http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}), testLogger(&bytes.Buffer{}))
	if srv.ReadHeaderTimeout != 5*time.Second || srv.ReadTimeout != 30*time.Second || srv.WriteTimeout != 60*time.Second || srv.IdleTimeout != 120*time.Second {
		t.Errorf("timeouts = header %v read %v write %v idle %v", srv.ReadHeaderTimeout, srv.ReadTimeout, srv.WriteTimeout, srv.IdleTimeout)
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
