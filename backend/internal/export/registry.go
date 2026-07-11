// Package export is the in-process replacement for the old GET
// /auth/export orchestrator's HTTP fan-out to five services' own
// /internal/export/{userId} endpoints (see PM REVIEW ADDENDUM on
// winzy.ai-rdc7.2: "closes a feature gap found in review... without this,
// data export would ship incomplete"). Each module registers a Section
// under its own name at startup; GET /auth/export (internal/auth) is the
// sole caller of Export, and assembles every registered section — its own
// "auth" section plus whatever later module beads have registered — into
// one document. A section erroring is reported as a warning, not a failed
// request, matching the old orchestrator's partial-failure contract.
package export

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
)

// Section produces one module's contribution to a user's data export.
type Section func(ctx context.Context, userID string) (any, error)

// ErrNoData is a Section's sentinel for "this user has nothing to export
// from this module" — distinct from a genuine failure. Export omits the
// section from its results the same way any other error does, but WITHOUT
// logging or adding a warning: matching the old export orchestrator's
// handling of a downstream 404 (AuthEndpoints.cs's ExportData treats a 404
// from a service's own /internal/export/{userId} call as `Failed: false`,
// never surfacing it as a warning). habits.exportSection returns this for a
// user with zero habits — see export.go.
var ErrNoData = errors.New("export: no data for this user")

// ServiceExport is one named module's export payload, matching the old
// per-service export response shape {"service": ..., "data": ...}.
type ServiceExport struct {
	Service string `json:"service"`
	Data    any    `json:"data"`
}

// Registry holds every module's registered export Section.
type Registry struct {
	mu       sync.RWMutex
	sections map[string]Section
	order    []string
	logger   *slog.Logger
}

// New returns an empty Registry.
func New(logger *slog.Logger) *Registry {
	return &Registry{
		sections: make(map[string]Section),
		logger:   logger,
	}
}

// Register adds a named section, keyed by module name ("auth", "habit",
// ...). Sections appear in Export's output in registration order.
// Re-registering the same name replaces its Section but keeps its original
// position.
func (r *Registry) Register(name string, section Section) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.sections[name]; !exists {
		r.order = append(r.order, name)
	}
	r.sections[name] = section
}

// Export runs every registered section for userID and returns the
// successful ones plus a human-readable warning for each that errored.
// Both return slices are non-nil (possibly empty) so callers can encode
// them directly as JSON arrays without a null-vs-empty-array ambiguity.
func (r *Registry) Export(ctx context.Context, userID string) ([]ServiceExport, []string) {
	r.mu.RLock()
	order := append([]string(nil), r.order...)
	sections := make(map[string]Section, len(r.sections))
	for name, section := range r.sections {
		sections[name] = section
	}
	r.mu.RUnlock()

	results := []ServiceExport{}
	warnings := []string{}

	for _, name := range order {
		data, err := sections[name](ctx, userID)
		if err != nil {
			if errors.Is(err, ErrNoData) {
				continue
			}
			r.logger.WarnContext(ctx, "export section failed", "section", name, "user_id", userID, "error", err)
			warnings = append(warnings, fmt.Sprintf("Failed to export data from %s", name))
			continue
		}
		results = append(results, ServiceExport{Service: name, Data: data})
	}

	return results, warnings
}
