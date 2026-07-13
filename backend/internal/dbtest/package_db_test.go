package dbtest

import (
	"strings"
	"testing"
)

func TestPackageTestDBName_HappyPath_AuthBasename(t *testing.T) {
	got := packageTestDBName("/Users/gabko14/work/side-projects/Winzy.ai/backend/internal/auth")
	wantPrefix := "winzy_test_auth_"
	if !strings.HasPrefix(got, wantPrefix) {
		t.Fatalf("got %q, want prefix %s", got, wantPrefix)
	}
	if len(got) != len(wantPrefix)+pathHashHexLen {
		t.Fatalf("got %q len=%d", got, len(got))
	}
	if len(got) > postgresIdentMax {
		t.Fatalf("len=%d > %d", len(got), postgresIdentMax)
	}
}

func TestPackageTestDBName_EdgeCase_BasenameCollisionDiffersByPath(t *testing.T) {
	a := packageTestDBName("/repo/backend/cmd/api")
	b := packageTestDBName("/repo/backend/internal/api")
	if a == b {
		t.Fatalf("expected distinct DBs for colliding basenames, both %q", a)
	}
	if !strings.HasPrefix(a, "winzy_test_api_") || !strings.HasPrefix(b, "winzy_test_api_") {
		t.Fatalf("a=%q b=%q", a, b)
	}
}

func TestPackageTestDBName_EdgeCase_LongBasenameTruncated(t *testing.T) {
	base := strings.Repeat("x", 80)
	got := packageTestDBName("/repo/" + base)
	if len(got) > postgresIdentMax {
		t.Fatalf("len=%d > 63: %q", len(got), got)
	}
	if !strings.HasPrefix(got, testDBPrefix) {
		t.Fatalf("got %q", got)
	}
}

func TestPackageTestDBName_HappyPath_Deterministic(t *testing.T) {
	wd := "/Users/x/backend/internal/habits"
	if packageTestDBName(wd) != packageTestDBName(wd) {
		t.Fatal("not deterministic")
	}
}

func TestRewriteDatabaseURL_HappyPath(t *testing.T) {
	got, err := rewriteDatabaseURL("postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable", "winzy_test_auth_deadbeef")
	if err != nil {
		t.Fatal(err)
	}
	want := "postgres://winzy:winzy@localhost:5439/winzy_test_auth_deadbeef?sslmode=disable"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestRewriteDatabaseURL_ErrorCase_NonURL(t *testing.T) {
	_, err := rewriteDatabaseURL("host=localhost dbname=winzy", "x")
	if err == nil {
		t.Fatal("expected error for non-URL DSN")
	}
}

func TestSanitizeIdent_EdgeCase_EmptyAndSymbols(t *testing.T) {
	if got := sanitizeIdent("Auth-Service!"); got != "auth_service" {
		t.Fatalf("got %q", got)
	}
	if got := sanitizeIdent("!!!"); got != "" {
		t.Fatalf("got %q", got)
	}
}

func TestMaintenanceDatabaseURL_HappyPath(t *testing.T) {
	got, err := maintenanceDatabaseURL("postgres://winzy:winzy@localhost:5439/winzy?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	want := "postgres://winzy:winzy@localhost:5439/postgres?sslmode=disable"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
