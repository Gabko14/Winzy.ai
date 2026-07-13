package goldenmaster

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadUsers_FromUsersFile_HappyPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "users.json")
	raw := `[
  {"id":"u1","email":"a@example.com","username":"alice"},
  {"id":"u2","email":"b@example.com","username":"bob"}
]`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	users, err := loadUsers(Config{UsersFile: path})
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 2 {
		t.Fatalf("want 2 users, got %d", len(users))
	}
	if users[0].Username != "alice" || users[1].ID != "u2" {
		t.Fatalf("unexpected users: %+v", users)
	}
}

func TestLoadUsers_FromUsersFile_Empty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "users.json")
	if err := os.WriteFile(path, []byte(`[]`), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := loadUsers(Config{UsersFile: path})
	if err == nil {
		t.Fatal("expected error for empty users file")
	}
}

func TestLoadUsers_FromUsersFile_Missing(t *testing.T) {
	_, err := loadUsers(Config{UsersFile: filepath.Join(t.TempDir(), "nope.json")})
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLoadUsers_NeitherSource(t *testing.T) {
	_, err := loadUsers(Config{})
	if err == nil {
		t.Fatal("expected error when neither users-file nor database-url set")
	}
}

func TestAsFloat_ExactNumericCompare(t *testing.T) {
	cases := []struct {
		name string
		a, b any
		eq   bool
	}{
		{"identical floats", float64(0.7333333333333333), float64(0.7333333333333333), true},
		{"bankers-rounding suspect", float64(0.5), float64(0.5000000000000001), false},
		{"zero", float64(0), float64(0), true},
		{"one vs zero", float64(1), float64(0), false},
		{"json.Number", json.Number("0.25"), float64(0.25), true},
		{"int vs float", int(1), float64(1), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			af, aok := asFloat(tc.a)
			bf, bok := asFloat(tc.b)
			if !aok || !bok {
				t.Fatalf("asFloat failed aok=%v bok=%v", aok, bok)
			}
			if (af == bf) != tc.eq {
				t.Fatalf("a=%v b=%v ==? want %v", af, bf, tc.eq)
			}
		})
	}
}

func TestAsFloat_RejectsNonNumeric(t *testing.T) {
	if _, ok := asFloat("0.5"); ok {
		t.Fatal("string must not parse as float")
	}
	if _, ok := asFloat(nil); ok {
		t.Fatal("nil must not parse as float")
	}
}

func TestFillPublic_SkipPrivateHabit(t *testing.T) {
	row := fillPublic(Row{HabitID: "h-private"}, "h-private",
		map[string]float64{"h-public": 0.5}, nil, nil,
		map[string]float64{"h-public": 0.5}, nil, nil,
	)
	if !row.Skipped {
		t.Fatalf("want skipped, got %+v", row)
	}
}

func TestFillPublic_ExactMatchAndDiff(t *testing.T) {
	match := fillPublic(Row{HabitID: "h1"}, "h1",
		map[string]float64{"h1": 0.8}, nil, nil,
		map[string]float64{"h1": 0.8}, nil, nil,
	)
	if !match.Match || match.Skipped || match.Error != "" {
		t.Fatalf("want match, got %+v", match)
	}
	diff := fillPublic(Row{HabitID: "h1"}, "h1",
		map[string]float64{"h1": 0.8}, nil, nil,
		map[string]float64{"h1": 0.8000000000000001}, nil, nil,
	)
	if diff.Match {
		t.Fatalf("want mismatch on exact float diverge, got %+v", diff)
	}
}

func TestMakeAuth_JWTRequiresSecret(t *testing.T) {
	_, err := makeAuth(Config{TokenMode: TokenModeJWT}, User{ID: "u", Email: "e@x.com"})
	if err == nil {
		t.Fatal("expected error without jwt secret")
	}
}

func TestMakeAuth_XUserID(t *testing.T) {
	a, err := makeAuth(Config{TokenMode: TokenModeXUserID}, User{ID: "user-42"})
	if err != nil {
		t.Fatal(err)
	}
	if a.headers["X-User-Id"] != "user-42" {
		t.Fatalf("headers=%v", a.headers)
	}
	if a.bearer != "" {
		t.Fatal("bearer should be empty in x-user-id mode")
	}
}

func TestWriteMismatchArtifact_ContainsBodies(t *testing.T) {
	dir := t.TempDir()
	old := 0.1
	newV := 0.2
	row := Row{
		Username:  "alice",
		HabitID:   "h1",
		Surface:   SurfaceOwnerUTC,
		OldValue:  &old,
		NewValue:  &newV,
		Match:     false,
		OldStatus: 200,
		NewStatus: 200,
		OldBody:   map[string]any{"consistency": 0.1},
		NewBody:   map[string]any{"consistency": 0.2},
	}
	if err := writeMismatchArtifact(dir, row); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("entries=%v err=%v", entries, err)
	}
	b, err := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got["oldBody"] == nil || got["newBody"] == nil {
		t.Fatalf("artifact missing bodies: %s", b)
	}
}
