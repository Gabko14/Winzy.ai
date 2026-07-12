package allowlist

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadAndSeededEntries(t *testing.T) {
	path := filepath.Join("..", "..", "allowlist.json")
	list, err := Load(path)
	if err != nil {
		t.Fatalf("Load(%s): %v", path, err)
	}
	seeded := list.Seeded()
	if len(seeded) == 0 {
		t.Fatal("expected seeded candidates from allowlist.json")
	}
	approved := list.Approved()
	if len(approved) < 4 {
		t.Fatalf("expected ≥4 approved response-surface entries (F1–F3,F6b), got %d", len(approved))
	}
}

func TestFilter_SeededNeverSuppresses(t *testing.T) {
	list := &List{entries: []Entry{{
		ID:              "seeded-cursor",
		Scenario:        "activity-feed-pagination",
		Field:           "$.nextCursor",
		ResponseSurface: true,
		Status:          StatusSeeded,
	}}}
	diffs := []string{"$.nextCursor: old != new"}
	res := list.Filter("activity-feed-pagination", diffs, 0)
	if len(res.Allowlisted) != 0 {
		t.Fatalf("seeded entry must not suppress diffs, got %#v", res.Allowlisted)
	}
	if len(res.Unexplained) != 1 {
		t.Fatalf("expected 1 unexplained, got %#v", res.Unexplained)
	}
}

func TestFilter_ApprovedSuppressesMatchingPath(t *testing.T) {
	list := &List{entries: []Entry{{
		ID:              "approved-cursor",
		Scenario:        "activity-feed-pagination",
		Field:           "$.nextCursor",
		ResponseSurface: true,
		Status:          StatusApproved,
		Justification:   "test",
		SourceBead:      "winzy.ai-rdc7.7",
	}}}
	diffs := []string{
		"$.nextCursor: a != b",
		"$.hasMore: true != false",
	}
	res := list.Filter("activity-feed-pagination", diffs, 0)
	if len(res.Allowlisted) != 1 || res.Allowlisted[0].Entry.ID != "approved-cursor" {
		t.Fatalf("expected nextCursor allowlisted, got %#v", res.Allowlisted)
	}
	if len(res.Unexplained) != 1 || res.Unexplained[0] != "$.hasMore: true != false" {
		t.Fatalf("expected hasMore unexplained, got %#v", res.Unexplained)
	}
}

func TestFilter_ScenarioMismatchDoesNotSuppress(t *testing.T) {
	list := &List{entries: []Entry{{
		ID:              "approved-cursor",
		Scenario:        "activity-feed-pagination",
		Field:           "$.nextCursor",
		ResponseSurface: true,
		Status:          StatusApproved,
	}}}
	res := list.Filter("other-scenario", []string{"$.nextCursor: a != b"}, 0)
	if len(res.Unexplained) != 1 || len(res.Allowlisted) != 0 {
		t.Fatalf("wrong-scenario must not suppress, got unexplained=%v allowlisted=%v", res.Unexplained, res.Allowlisted)
	}
}

func TestFilter_RootFieldExactOnly(t *testing.T) {
	list := &List{entries: []Entry{{
		ID:              "401-error-body",
		Scenario:        "error-shapes-and-401",
		Field:           "$",
		ResponseSurface: true,
		Status:          StatusApproved,
	}}}
	res := list.Filter("error-shapes-and-401", []string{
		"$: <nil> != map[error:unauthorized]",
		"$.error: present in B only (value=unauthorized)",
	}, 401)
	if len(res.Allowlisted) != 1 || res.Allowlisted[0].Entry.ID != "401-error-body" {
		t.Fatalf("expected only root $ allowlisted, got %#v", res.Allowlisted)
	}
	if len(res.Unexplained) != 1 || !strings.HasPrefix(res.Unexplained[0], "$.error:") {
		t.Fatalf("$.error must remain unexplained when Field is $, got %#v", res.Unexplained)
	}
}

func TestFilter_ApprovedSuffixField(t *testing.T) {
	list := &List{entries: []Entry{{
		ID:              "export-empty-collections-present",
		Scenario:        "auth-export-equivalence",
		Field:           "promises",
		ResponseSurface: true,
		Status:          StatusApproved,
	}}}
	res := list.Filter("auth-export-equivalence", []string{
		"$.services[1].data.habits[0].promises: present in B only (value=[])",
		"$.services[0].data.email: a != b",
	}, 200)
	if len(res.Allowlisted) != 1 {
		t.Fatalf("expected promises suffix match, got %#v", res.Allowlisted)
	}
	if len(res.Unexplained) != 1 {
		t.Fatalf("expected email unexplained, got %#v", res.Unexplained)
	}
}

func TestFilter_NonResponseSurfaceNeverSuppresses(t *testing.T) {
	list := &List{entries: []Entry{{
		ID:              "internal-only",
		Scenario:        "*",
		Field:           "*",
		ResponseSurface: false,
		Status:          StatusApproved,
	}}}
	res := list.Filter("any", []string{"$.x: 1 != 2"}, 0)
	if len(res.Allowlisted) != 0 {
		t.Fatalf("response_surface=false must never suppress, got %#v", res.Allowlisted)
	}
}

func TestFilter_WhenStatusGatesMatch(t *testing.T) {
	list := &List{entries: []Entry{{
		ID:              "429-error-body",
		Scenario:        "*",
		Field:           "$.error",
		ResponseSurface: true,
		Status:          StatusApproved,
		WhenStatus:      429,
	}}}
	on429 := list.Filter("auth-export-equivalence", []string{"$.error: present in B only (value=Too many requests.)"}, 429)
	if len(on429.Allowlisted) != 1 {
		t.Fatalf("expected 429 suppress, got %#v", on429)
	}
	on400 := list.Filter("auth-validation-and-conflict", []string{"$.error: present in B only (value=x)"}, 400)
	if len(on400.Allowlisted) != 0 || len(on400.Unexplained) != 1 {
		t.Fatalf("when_status=429 must not suppress on 400, got %#v", on400)
	}
}

func TestLoad_MissingFile(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "nope.json"))
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLoad_EmptyPath(t *testing.T) {
	list, err := Load("")
	if err != nil {
		t.Fatal(err)
	}
	res := list.Filter("s", []string{"$.a: 1 != 2"}, 0)
	if len(res.Unexplained) != 1 {
		t.Fatalf("empty allowlist should pass diffs through, got %#v", res)
	}
}

func TestLoad_InvalidJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(path, []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Load(path)
	if err == nil {
		t.Fatal("expected parse error")
	}
}
