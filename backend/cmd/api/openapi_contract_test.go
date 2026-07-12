package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/activity"
	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/challenges"
	"github.com/Gabko14/winzy/backend/internal/habits"
	"github.com/Gabko14/winzy/backend/internal/notifications"
	"github.com/Gabko14/winzy/backend/internal/social"
	"gopkg.in/yaml.v3"
)

type recordingMux struct {
	inner    *http.ServeMux
	patterns []string
}

func (r *recordingMux) HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request)) {
	r.patterns = append(r.patterns, pattern)
	r.inner.HandleFunc(pattern, handler)
}

type openAPIDoc struct {
	Paths map[string]map[string]any `yaml:"paths"`
}

var httpMethods = map[string]bool{
	"get": true, "post": true, "put": true, "patch": true, "delete": true,
	"head": true, "options": true, "trace": true,
}

var pathParamRE = regexp.MustCompile(`\{[^}]+\}`)

func TestOpenAPIRoutes_BidirectionalDrift(t *testing.T) {
	spec := loadOpenAPI(t)

	rec := &recordingMux{inner: http.NewServeMux()}
	registerAPIRoutes(rec, apiHandlers{
		health:        func(http.ResponseWriter, *http.Request) {},
		auth:          &auth.Handlers{},
		habits:        &habits.Handlers{},
		social:        &social.Handlers{},
		challenges:    &challenges.Handlers{},
		notifications: &notifications.Handlers{},
		activity:      &activity.Handlers{},
	})

	if len(rec.patterns) == 0 {
		t.Fatal("no routes registered")
	}

	covered := make(map[string]bool)
	var specOps int

	for path, methods := range spec.Paths {
		for method, op := range methods {
			if !httpMethods[strings.ToLower(method)] {
				continue
			}
			if op == nil {
				continue
			}
			specOps++
			concrete := fillPathParams(path)
			req := httptest.NewRequest(strings.ToUpper(method), concrete, nil)
			_, pattern := rec.inner.Handler(req)
			if pattern == "" {
				t.Errorf("spec %s %s (concrete %s) has no matching mux handler", strings.ToUpper(method), path, concrete)
				continue
			}
			covered[pattern] = true
		}
	}

	if specOps == 0 {
		t.Fatal("openapi.yaml has no path operations")
	}

	for _, pattern := range rec.patterns {
		if !covered[pattern] {
			t.Errorf("registered route %q is not covered by any OpenAPI path", pattern)
		}
	}
}

func loadOpenAPI(t *testing.T) openAPIDoc {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	specPath := filepath.Join(filepath.Dir(thisFile), "..", "..", "openapi", "openapi.yaml")
	data, err := os.ReadFile(specPath)
	if err != nil {
		t.Fatalf("read openapi.yaml: %v", err)
	}
	var doc openAPIDoc
	if err := yaml.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parse openapi.yaml: %v", err)
	}
	if len(doc.Paths) == 0 {
		t.Fatal("openapi.yaml has empty paths")
	}
	return doc
}

func fillPathParams(path string) string {
	i := 0
	return pathParamRE.ReplaceAllStringFunc(path, func(param string) string {
		name := strings.Trim(param, "{}")
		i++
		switch name {
		case "username":
			return "alice"
		case "token":
			return "witnesstoken"
		case "date":
			return "2026-01-15"
		case "friendId":
			return "22222222-2222-2222-2222-222222222222"
		case "habitId":
			return "33333333-3333-3333-3333-333333333333"
		default:
			// UUID-shaped so habits' isValidUUID paths and ServeMux wildcards behave normally.
			return "11111111-1111-1111-1111-111111111111"
		}
	})
}
