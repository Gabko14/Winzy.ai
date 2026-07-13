package config

import "testing"

func TestAssertNotForbidden_ErrorCase_WinzyAndParity(t *testing.T) {
	for _, db := range []string{"winzy", "winzy_parity", "WINZY"} {
		if err := AssertNotForbidden(db); err == nil {
			t.Errorf("AssertNotForbidden(%q) = nil, want error", db)
		}
	}
}

func TestAssertNotForbidden_HappyPath_ManagedDBs(t *testing.T) {
	for _, db := range AllManagedDBs() {
		if err := AssertNotForbidden(db); err != nil {
			t.Errorf("AssertNotForbidden(%q) = %v", db, err)
		}
	}
}

func TestExpectedCounts_EdgeCase_MatchesBeadArchive(t *testing.T) {
	want := map[string]int{
		"users": 6, "habits": 10, "completions": 63, "promises": 0,
		"friendships": 2, "social_preferences": 1, "visibility_settings": 10,
		"witness_links": 1, "witness_link_habits": 2, "challenges": 1,
		"notifications": 61, "device_tokens": 0, "notification_settings": 0,
		"feed_entries": 92, "refresh_tokens": 169,
	}
	for k, v := range want {
		if ExpectedCounts[k] != v {
			t.Errorf("ExpectedCounts[%s]=%d want %d", k, ExpectedCounts[k], v)
		}
	}
}

func TestTargetURL_HappyPath_DefaultLocalUnchanged(t *testing.T) {
	cfg := Default()
	want := "postgres://winzy:winzy@localhost:5440/winzy_rehearsal?sslmode=disable"
	if got := cfg.TargetURL(); got != want {
		t.Fatalf("default TargetURL() = %q, want %q", got, want)
	}
	db, err := cfg.EffectiveTargetDB()
	if err != nil {
		t.Fatalf("EffectiveTargetDB: %v", err)
	}
	if db != TargetDB {
		t.Fatalf("EffectiveTargetDB = %q, want %q", db, TargetDB)
	}
	if err := cfg.ValidateTarget(); err != nil {
		t.Fatalf("ValidateTarget: %v", err)
	}
}

func TestTargetURL_HappyPath_RailwayStyleOverride(t *testing.T) {
	cfg := Default()
	cfg.User = "railway"
	cfg.Password = "secret"
	cfg.Host = "ignored.example"
	cfg.Port = "5432"
	cfg.SSLMode = "disable"
	cfg.TargetDBName = "ignored_local"
	cfg.TargetURLOverride = "postgres://railway:secret@roundhouse.proxy.rlwy.net:12345/railway?sslmode=require"

	want := cfg.TargetURLOverride
	if got := cfg.TargetURL(); got != want {
		t.Fatalf("TargetURL() = %q, want override %q", got, want)
	}
	db, err := cfg.EffectiveTargetDB()
	if err != nil {
		t.Fatalf("EffectiveTargetDB: %v", err)
	}
	if db != "railway" {
		t.Fatalf("EffectiveTargetDB = %q, want railway", db)
	}
	if err := cfg.ValidateTarget(); err != nil {
		t.Fatalf("ValidateTarget: %v", err)
	}

	// Source composition still uses sslmode flag + host parts (local sources).
	src := cfg.SourceURL("winzy_mig_src_auth")
	wantSrc := "postgres://railway:secret@ignored.example:5432/winzy_mig_src_auth?sslmode=disable"
	if src != wantSrc {
		t.Fatalf("SourceURL = %q, want %q", src, wantSrc)
	}
}

func TestTargetURL_HappyPath_ComposedTargetDBAndSSLMode(t *testing.T) {
	cfg := Default()
	cfg.TargetDBName = "winzy_cutover"
	cfg.SSLMode = "require"
	cfg.User = "cutover_user"
	cfg.Password = "pw"
	cfg.Host = "db.example.com"
	cfg.Port = "5432"

	want := "postgres://cutover_user:pw@db.example.com:5432/winzy_cutover?sslmode=require"
	if got := cfg.TargetURL(); got != want {
		t.Fatalf("TargetURL() = %q, want %q", got, want)
	}
	db, err := cfg.EffectiveTargetDB()
	if err != nil {
		t.Fatalf("EffectiveTargetDB: %v", err)
	}
	if db != "winzy_cutover" {
		t.Fatalf("EffectiveTargetDB = %q, want winzy_cutover", db)
	}
}

func TestValidateTarget_ErrorCase_ForbiddenInOverrideURL(t *testing.T) {
	cfg := Default()
	cfg.TargetURLOverride = "postgres://u:p@host:5432/winzy?sslmode=require"
	if err := cfg.ValidateTarget(); err == nil {
		t.Fatal("ValidateTarget() = nil, want forbidden error for db winzy")
	}
	cfg.TargetURLOverride = "postgres://u:p@host:5432/winzy_parity?sslmode=require"
	if err := cfg.ValidateTarget(); err == nil {
		t.Fatal("ValidateTarget() = nil, want forbidden error for db winzy_parity")
	}
}

func TestValidateTarget_ErrorCase_ForbiddenComposedTargetDB(t *testing.T) {
	cfg := Default()
	cfg.TargetDBName = "winzy"
	if err := cfg.ValidateTarget(); err == nil {
		t.Fatal("ValidateTarget() = nil, want forbidden error")
	}
}

func TestValidateTarget_ErrorCase_UnparseableOrIncompleteURL(t *testing.T) {
	cases := []string{
		"://bad",
		"http://host/db",
		"postgres://user:pass@host:5432/",
		"postgres:///dbname",
		"not a url at all %%%",
	}
	for _, raw := range cases {
		cfg := Default()
		cfg.TargetURLOverride = raw
		if err := cfg.ValidateTarget(); err == nil {
			t.Errorf("ValidateTarget(%q) = nil, want error", raw)
		}
	}
}

func TestDatabaseNameFromURL_HappyPath_PostgresAndPostgresql(t *testing.T) {
	for _, raw := range []string{
		"postgres://u:p@h:1/mydb?sslmode=require",
		"postgresql://u:p@h:1/mydb",
	} {
		got, err := DatabaseNameFromURL(raw)
		if err != nil {
			t.Fatalf("DatabaseNameFromURL(%q): %v", raw, err)
		}
		if got != "mydb" {
			t.Fatalf("DatabaseNameFromURL(%q) = %q, want mydb", raw, got)
		}
	}
}
