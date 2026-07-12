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
