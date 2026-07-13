package web

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsAPIPath(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/auth/login", true},
		{"/auth", true},
		{"/habits", true},
		{"/habits/public/alice", true},
		{"/social/witness/tok", true},
		{"/challenges/x", true},
		{"/notifications/unread-count", true},
		{"/activity/feed", true},
		{"/health", true},
		{"/health/ready", true},
		{"/authenticate", false},
		{"/@alice", false},
		{"/", false},
		{"/index.html", false},
		{"/assets/icon.png", false},
		{"/friends", false},
	}
	for _, tc := range cases {
		if got := IsAPIPath(tc.path); got != tc.want {
			t.Errorf("IsAPIPath(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}

func TestSPAHandler_ServesFilesAndFallback(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "index.html"), "<html>spa</html>")
	mustWrite(t, filepath.Join(root, "app.js"), "console.log(1)")
	mustWrite(t, filepath.Join(root, "assets", "icon.png"), "png")

	h := SPAHandler(root)

	t.Run("index at slash", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "spa") {
			t.Fatalf("body = %q, want index.html", rec.Body.String())
		}
	})

	t.Run("existing asset", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/icon.png", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
		if rec.Body.String() != "png" {
			t.Fatalf("body = %q", rec.Body.String())
		}
	})

	t.Run("existing js", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/app.js", nil))
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "console") {
			t.Fatalf("status=%d body=%q", rec.Code, rec.Body.String())
		}
	})

	t.Run("spa fallback for /@username", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/@alice", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "spa") {
			t.Fatalf("body = %q, want index.html fallback", rec.Body.String())
		}
	})
}

func TestSPAHandler_CacheHeaders(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "index.html"), "<html>spa</html>")
	mustWrite(t, filepath.Join(root, "sw.js"), "// sw")
	mustWrite(t, filepath.Join(root, "assets", "icon.png"), "png")
	mustWrite(t, filepath.Join(root, "_expo", "static", "js", "app-abc123.js"), "bundle")

	h := SPAHandler(root)

	const immutable = "public, max-age=31536000, immutable"
	cases := []struct {
		path string
		want string
	}{
		{"/", "no-cache"}, // FileServer 301s /index.html to / — this covers index
		{"/sw.js", "no-cache"},
		{"/assets/icon.png", "no-cache"},
		{"/_expo/static/js/app-abc123.js", immutable},
		{"/@alice", "no-cache"},                  // SPA fallback
		{"/does/not/exist", "no-cache"},          // SPA fallback
		{"/_expo/static/js/gone.js", "no-cache"}, // missing file -> fallback, must not be immutable
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d", tc.path, rec.Code)
			continue
		}
		if got := rec.Header().Get("Cache-Control"); got != tc.want {
			t.Errorf("%s: Cache-Control = %q, want %q", tc.path, got, tc.want)
		}
	}
}

func TestSplitHandler_APIPrecedenceAndStaticBypass(t *testing.T) {
	apiHits := 0
	staticHits := 0
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiHits++
		if r.URL.Path == "/habits/nope" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "api:"+r.URL.Path)
	})
	static := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		staticHits++
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "static:"+r.URL.Path)
	})
	h := SplitHandler(api, static)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/habits", nil))
	if rec.Body.String() != "api:/habits" || apiHits != 1 || staticHits != 0 {
		t.Fatalf("habits: body=%q api=%d static=%d", rec.Body.String(), apiHits, staticHits)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/habits/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown API path status = %d, want 404 (not SPA)", rec.Code)
	}
	if staticHits != 0 {
		t.Fatal("static must not handle unknown API paths")
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/@bob", nil))
	if rec.Body.String() != "static:/@bob" || staticHits != 1 {
		t.Fatalf("spa path: body=%q static=%d", rec.Body.String(), staticHits)
	}
}

func TestSplitHandler_UnknownAPIPathNotIndexHTML(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "index.html"), "<html>spa</html>")

	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	h := SplitHandler(api, SPAHandler(root))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/auth/does-not-exist", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "spa") {
		t.Fatalf("API 404 must not serve index.html, body=%q", rec.Body.String())
	}
}

func mustWrite(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}
