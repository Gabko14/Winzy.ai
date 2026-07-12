// Package allowlist loads the reviewed intentional old-vs-Go diff list for
// winzy.ai-rdc7.12 phase 2 and filters normalize.Diff output so only
// unexplained field paths fail a check run.
//
// Matching rules:
//   - Only entries with status "approved" AND response_surface=true can
//     suppress a live diff. Seeded documentation entries never auto-pass.
//   - scenario must equal the running scenario name, or be "*".
//   - field is matched as a path prefix against each diff line's JSON path
//     (the substring before the first ": "). "*" matches any path.
//
// NEW diffs discovered at runtime must be reported to the PM as findings;
// they must not be flipped to approved by a worker without explicit GO.
package allowlist

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const (
	StatusSeeded   = "seeded"
	StatusApproved = "approved"
	StatusFinding  = "finding"
)

// Entry is one reviewed (or candidate) intentional divergence.
type Entry struct {
	ID              string `json:"id"`
	Scenario        string `json:"scenario"`
	Field           string `json:"field"`
	OldShape        string `json:"old_shape"`
	NewShape        string `json:"new_shape"`
	Justification   string `json:"justification"`
	SourceBead      string `json:"source_bead"`
	ResponseSurface bool   `json:"response_surface"`
	Status          string `json:"status"`
}

// File is the on-disk allowlist.json shape.
type File struct {
	Version     int     `json:"version"`
	Description string  `json:"description"`
	Entries     []Entry `json:"entries"`
}

// List is the runtime filter over a loaded File.
type List struct {
	path    string
	entries []Entry
}

// Load reads path. An empty path returns an empty list (no filtering).
func Load(path string) (*List, error) {
	if path == "" {
		return &List{}, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("allowlist: read %s: %w", path, err)
	}
	var f File
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("allowlist: parse %s: %w", path, err)
	}
	return &List{path: path, entries: f.Entries}, nil
}

// Path returns the source path, if any.
func (l *List) Path() string {
	if l == nil {
		return ""
	}
	return l.path
}

// Entries returns a copy of all loaded entries (seeded + approved).
func (l *List) Entries() []Entry {
	if l == nil {
		return nil
	}
	out := make([]Entry, len(l.entries))
	copy(out, l.entries)
	return out
}

// Seeded returns entries that document candidates but do not suppress diffs.
func (l *List) Seeded() []Entry {
	return l.filterStatus(StatusSeeded)
}

// Approved returns entries that may suppress matching response-surface diffs.
func (l *List) Approved() []Entry {
	return l.filterStatus(StatusApproved)
}

func (l *List) filterStatus(status string) []Entry {
	if l == nil {
		return nil
	}
	var out []Entry
	for _, e := range l.entries {
		if e.Status == status {
			out = append(out, e)
		}
	}
	return out
}

// Result is the split of a step's field-level diffs after allowlist filtering.
type Result struct {
	Unexplained []string
	Allowlisted []Matched
}

// Matched pairs a suppressed diff line with the entry that matched it.
type Matched struct {
	Diff  string
	Entry Entry
}

// Filter splits diffs for scenario into unexplained vs allowlisted.
// Only approved + response_surface entries can move a diff into Allowlisted.
func (l *List) Filter(scenario string, diffs []string) Result {
	res := Result{Unexplained: make([]string, 0, len(diffs))}
	if l == nil || len(l.entries) == 0 {
		res.Unexplained = append(res.Unexplained, diffs...)
		return res
	}
	for _, d := range diffs {
		path := diffPath(d)
		if e, ok := l.match(scenario, path); ok {
			res.Allowlisted = append(res.Allowlisted, Matched{Diff: d, Entry: e})
			continue
		}
		res.Unexplained = append(res.Unexplained, d)
	}
	return res
}

func (l *List) match(scenario, path string) (Entry, bool) {
	for _, e := range l.entries {
		if e.Status != StatusApproved || !e.ResponseSurface {
			continue
		}
		if e.Scenario != "*" && e.Scenario != scenario {
			continue
		}
		if e.Field == "*" {
			return e, true
		}
		if path == e.Field {
			return e, true
		}
		// Field "$" is exact-only — prefix matching would swallow every
		// "$.…" path in the document (F2 is a root-body shape diff).
		if e.Field == "$" {
			continue
		}
		if strings.HasPrefix(path, e.Field+".") || strings.HasPrefix(path, e.Field+"[") {
			return e, true
		}
		// Bare key (e.g. "promises", "actorDisplayName") matches a path suffix.
		if e.Field != "" && (strings.HasSuffix(path, "."+e.Field) || path == "$."+strings.TrimPrefix(e.Field, "$.")) {
			return e, true
		}
	}
	return Entry{}, false
}

// diffPath extracts the JSON path from a normalize.Diff line ("path: ...").
func diffPath(diff string) string {
	i := strings.Index(diff, ": ")
	if i < 0 {
		return diff
	}
	return diff[:i]
}
