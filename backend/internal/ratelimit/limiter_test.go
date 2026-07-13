package ratelimit_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/ratelimit"
)

func TestAllow_HappyPath_FirstRequestWithinLimitIsAllowed(t *testing.T) {
	l := ratelimit.New(1, time.Minute)

	if !l.Allow("1.2.3.4") {
		t.Error("first request should be allowed")
	}
}

func TestAllow_EdgeCase_ExactlyAtLimitStillAllowed(t *testing.T) {
	l := ratelimit.New(3, time.Minute)
	key := "1.2.3.4"

	for i := 0; i < 3; i++ {
		if !l.Allow(key) {
			t.Fatalf("request %d of 3 should be allowed", i+1)
		}
	}
}

func TestAllow_EdgeCase_DifferentKeysHaveIndependentLimits(t *testing.T) {
	l := ratelimit.New(1, time.Minute)

	if !l.Allow("1.1.1.1") {
		t.Error("first key's first request should be allowed")
	}
	if !l.Allow("2.2.2.2") {
		t.Error("second key's first request should be allowed independently")
	}
	if l.Allow("1.1.1.1") {
		t.Error("first key's second request should be denied")
	}
}

func TestAllow_EdgeCase_AfterWindowExpiresRequestAllowedAgain(t *testing.T) {
	l := ratelimit.New(1, 50*time.Millisecond)
	key := "1.2.3.4"

	if !l.Allow(key) {
		t.Fatal("first request should be allowed")
	}
	if l.Allow(key) {
		t.Fatal("second request within the window should be denied")
	}

	time.Sleep(100 * time.Millisecond)

	if !l.Allow(key) {
		t.Error("request after the window expired should be allowed")
	}
}

func TestAllow_ErrorCase_RequestOverLimitDenied(t *testing.T) {
	l := ratelimit.New(2, time.Minute)
	key := "1.2.3.4"

	l.Allow(key)
	l.Allow(key)

	if l.Allow(key) {
		t.Error("third request over a limit of 2 should be denied")
	}
}

func TestNew_ErrorCase_PanicsOnInvalidLimit(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("New(0, ...) should panic")
		}
	}()
	ratelimit.New(0, time.Minute)
}

func TestNew_ErrorCase_PanicsOnNonPositiveWindow(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("New(1, 0) should panic")
		}
	}()
	ratelimit.New(1, 0)
}

func TestClientIP_HappyPath_StripsPort(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.5:54321"

	if got := ratelimit.ClientIP(r, false); got != "203.0.113.5" {
		t.Errorf("ClientIP() = %q, want 203.0.113.5", got)
	}
}

func TestClientIP_EdgeCase_MalformedRemoteAddrReturnedVerbatim(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "not-a-valid-remote-addr"

	if got := ratelimit.ClientIP(r, false); got != "not-a-valid-remote-addr" {
		t.Errorf("ClientIP() = %q, want the raw RemoteAddr as a fallback", got)
	}
}

func TestClientIP_HappyPath_TrustedProxyUsesLeftmostForwardedFor(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.2:1234"
	r.Header.Set("X-Forwarded-For", "203.0.113.9, 10.10.10.10")
	if got := ratelimit.ClientIP(r, true); got != "203.0.113.9" {
		t.Errorf("ClientIP() = %q, want leftmost X-Forwarded-For entry", got)
	}
}

func TestClientIP_HappyPath_TrustedProxySingleForwardedFor(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.2:1234"
	r.Header.Set("X-Forwarded-For", "203.0.113.9")
	if got := ratelimit.ClientIP(r, true); got != "203.0.113.9" {
		t.Errorf("ClientIP() = %q, want the sole X-Forwarded-For entry", got)
	}
}

func TestClientIP_EdgeCase_TrustedProxyIgnoresRealIPHeader(t *testing.T) {
	// Railway sets X-Real-IP to the CDN edge IP when its CDN is in the
	// path (known Railway bug) — the limiter must not read it at all.
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.5:1234"
	r.Header.Set("X-Real-IP", "198.51.100.9")
	if got := ratelimit.ClientIP(r, true); got != "203.0.113.5" {
		t.Errorf("ClientIP() = %q, want RemoteAddr (X-Real-IP must be ignored)", got)
	}
}

func TestClientIP_ErrorCase_UntrustedProxyIgnoresSpoofedHeaders(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.5:1234"
	r.Header.Set("X-Real-IP", "198.51.100.9")
	r.Header.Set("X-Forwarded-For", "192.0.2.10")
	if got := ratelimit.ClientIP(r, false); got != "203.0.113.5" {
		t.Errorf("ClientIP() = %q, want RemoteAddr with proxy trust disabled", got)
	}
}

func TestClientIP_EdgeCase_TrustedProxyFallsBackWhenHeaderMissing(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.5:1234"
	if got := ratelimit.ClientIP(r, true); got != "203.0.113.5" {
		t.Errorf("ClientIP() = %q, want RemoteAddr fallback", got)
	}
}

func TestClientIP_ErrorCase_TrustedProxyRejectsMalformedForwardedFor(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.5:1234"
	r.Header.Set("X-Forwarded-For", "attacker-controlled-bucket")
	if got := ratelimit.ClientIP(r, true); got != "203.0.113.5" {
		t.Errorf("ClientIP() = %q, want RemoteAddr fallback for malformed X-Forwarded-For", got)
	}
}

func TestPrefixMiddleware_HappyPath_AuthPrefixUsesAuthLimiter(t *testing.T) {
	general := ratelimit.New(100, time.Minute)
	auth := ratelimit.New(1, time.Minute)
	mw := ratelimit.PrefixMiddleware(general, auth, "/auth/", false)

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req1 := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	req1.RemoteAddr = "9.9.9.9:1"
	rec1 := httptest.NewRecorder()
	handler.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first /auth/login request status = %d, want 200", rec1.Code)
	}

	req2 := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	req2.RemoteAddr = "9.9.9.9:2"
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusTooManyRequests {
		t.Errorf("second /auth/login request status = %d, want 429 (auth limiter allows only 1)", rec2.Code)
	}
}

func TestPrefixMiddleware_EdgeCase_NonAuthPathUnaffectedByAuthLimiter(t *testing.T) {
	general := ratelimit.New(100, time.Minute)
	auth := ratelimit.New(1, time.Minute)
	mw := ratelimit.PrefixMiddleware(general, auth, "/auth/", false)

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust the auth limiter for this IP.
	authReq := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	authReq.RemoteAddr = "9.9.9.9:1"
	handler.ServeHTTP(httptest.NewRecorder(), authReq)

	// A request to a non-auth path from the same IP must still be allowed —
	// it is governed by the separate general limiter.
	otherReq := httptest.NewRequest(http.MethodGet, "/habits", nil)
	otherReq.RemoteAddr = "9.9.9.9:2"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, otherReq)
	if rec.Code != http.StatusOK {
		t.Errorf("non-auth path status = %d, want 200 (must use the general limiter, not the exhausted auth one)", rec.Code)
	}
}

func TestPrefixMiddleware_ErrorCase_GeneralLimiterExhaustedDeniesNonAuthPath(t *testing.T) {
	general := ratelimit.New(1, time.Minute)
	auth := ratelimit.New(100, time.Minute)
	mw := ratelimit.PrefixMiddleware(general, auth, "/auth/", false)

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req1 := httptest.NewRequest(http.MethodGet, "/habits", nil)
	req1.RemoteAddr = "8.8.8.8:1"
	handler.ServeHTTP(httptest.NewRecorder(), req1)

	req2 := httptest.NewRequest(http.MethodGet, "/habits", nil)
	req2.RemoteAddr = "8.8.8.8:2"
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusTooManyRequests {
		t.Errorf("second /habits request status = %d, want 429", rec2.Code)
	}
}

func TestPrefixMiddleware_HappyPath_TrustedProxySeparatesClientBuckets(t *testing.T) {
	general := ratelimit.New(100, time.Minute)
	auth := ratelimit.New(1, time.Minute)
	handler := ratelimit.PrefixMiddleware(general, auth, "/auth/", true)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for _, ip := range []string{"203.0.113.1", "203.0.113.2"} {
		req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		req.RemoteAddr = "10.0.0.2:1234"
		req.Header.Set("X-Forwarded-For", ip)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("client %s status = %d, want independent 200", ip, rec.Code)
		}
	}
}
