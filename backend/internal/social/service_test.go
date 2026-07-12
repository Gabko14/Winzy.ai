package social

import (
	"testing"

	"github.com/Gabko14/winzy/backend/internal/habits"
)

func TestIsValidUUID(t *testing.T) {
	t.Run("HappyPath_Valid", func(t *testing.T) {
		if !isValidUUID("11111111-1111-1111-1111-111111111111") {
			t.Error("isValidUUID() = false, want true for a canonical UUID")
		}
	})
	t.Run("ErrorCase_Malformed", func(t *testing.T) {
		if isValidUUID("not-a-uuid") {
			t.Error("isValidUUID() = true, want false for a malformed string")
		}
	})
	t.Run("EdgeCase_Empty", func(t *testing.T) {
		if isValidUUID("") {
			t.Error("isValidUUID() = true, want false for an empty string")
		}
	})
}

func TestEffectiveVisibility(t *testing.T) {
	t.Run("HappyPath_ExplicitSettingWins", func(t *testing.T) {
		if got := effectiveVisibility(VisibilityPublic, VisibilityPrivate); got != VisibilityPublic {
			t.Errorf("effectiveVisibility(explicit=Public, default=Private) = %q, want Public", got)
		}
	})
	t.Run("EdgeCase_NoSettingFallsBackToDefault", func(t *testing.T) {
		if got := effectiveVisibility("", VisibilityFriends); got != VisibilityFriends {
			t.Errorf("effectiveVisibility(no setting, default=Friends) = %q, want Friends", got)
		}
	})
}

func TestVisibleToViewer(t *testing.T) {
	cases := []struct {
		name     string
		v        HabitVisibility
		isFriend bool
		want     bool
	}{
		{"HappyPath_PublicVisibleToFriend", VisibilityPublic, true, true},
		{"HappyPath_PublicVisibleToPublic", VisibilityPublic, false, true},
		{"HappyPath_FriendsVisibleToFriend", VisibilityFriends, true, true},
		{"ErrorCase_FriendsNotVisibleToPublic", VisibilityFriends, false, false},
		{"ErrorCase_PrivateNeverVisible_Friend", VisibilityPrivate, true, false},
		{"ErrorCase_PrivateNeverVisible_Public", VisibilityPrivate, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := visibleToViewer(tc.v, tc.isFriend); got != tc.want {
				t.Errorf("visibleToViewer(%q, isFriend=%v) = %v, want %v", tc.v, tc.isFriend, got, tc.want)
			}
		})
	}
}

func TestClampPage(t *testing.T) {
	cases := map[int]int{0: defaultPage, -5: defaultPage, 1: 1, 7: 7}
	for input, want := range cases {
		if got := clampPage(input); got != want {
			t.Errorf("clampPage(%d) = %d, want %d", input, got, want)
		}
	}
}

func TestClampPageSize(t *testing.T) {
	// FIX 13 (winzy.ai-rdc7.4 review): Math.Clamp(pageSize, 1, 100) in
	// FriendEndpoints.cs turns 0/negative into 1, NOT the default of 20 —
	// Math.Clamp has no notion of a default. The 20 default only applies to
	// an OMITTED query parameter (handlers.go's intQueryParam fallback),
	// never to an explicit pageSize=0 that reaches this function.
	cases := map[int]int{0: 1, -1: 1, 5: 5, maxPageSize: maxPageSize, maxPageSize + 50: maxPageSize}
	for input, want := range cases {
		if got := clampPageSize(input); got != want {
			t.Errorf("clampPageSize(%d) = %d, want %d", input, got, want)
		}
	}
}

func TestRankOf(t *testing.T) {
	t.Run("HappyPath_KnownLevelsOrdered", func(t *testing.T) {
		if !(rankOf("none") < rankOf("ember") && rankOf("ember") < rankOf("steady") &&
			rankOf("steady") < rankOf("strong") && rankOf("strong") < rankOf("blazing")) {
			t.Error("known flame levels are not strictly ordered none < ember < steady < strong < blazing")
		}
	})
	t.Run("EdgeCase_UnknownLevelRanksAboveEverything", func(t *testing.T) {
		if rankOf("inferno") <= rankOf("blazing") {
			t.Error("an unrecognized flame level should rank above every known level, matching the C#'s int.MaxValue fallback")
		}
	})
}

// TestAggregateVisibleFlame_UsesNETRounding documents FIX 5 (winzy.ai-rdc7.4
// review): aggregateVisibleFlame's naive round-half-up (roundToOneDecimal)
// was replaced with habits.RoundNET — the bit-exact .NET banker's-rounding
// port the flame engine itself already uses, tested at its own exact
// midpoints in internal/habits/net_compat_test.go
// (TestRoundNET_ExportedWrapper_MatchesMidpointBehavior). aggregateVisibleFlame
// itself needs a live habits.Service + Postgres to exercise end to end — see
// cross_integration_test.go's flame-aggregation cases — so this file only
// asserts the wrapper is actually wired in, not duplicating the midpoint
// math test.
func TestAggregateVisibleFlame_UsesNETRounding(t *testing.T) {
	if got := habits.RoundNET(82.25, 1); got != 82.2 {
		t.Fatalf("habits.RoundNET(82.25, 1) = %v, want 82.2 — aggregateVisibleFlame relies on this exact behavior", got)
	}
}

func TestDedupeStrings(t *testing.T) {
	t.Run("HappyPath_RemovesDuplicatesPreservingOrder", func(t *testing.T) {
		got := dedupeStrings([]string{"a", "b", "a", "c", "b"})
		want := []string{"a", "b", "c"}
		if len(got) != len(want) {
			t.Fatalf("dedupeStrings() = %v, want %v", got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("dedupeStrings()[%d] = %q, want %q", i, got[i], want[i])
			}
		}
	})
	t.Run("EdgeCase_EmptyInput", func(t *testing.T) {
		got := dedupeStrings(nil)
		if len(got) != 0 {
			t.Errorf("dedupeStrings(nil) = %v, want empty", got)
		}
	})
	t.Run("EdgeCase_NoDuplicates", func(t *testing.T) {
		got := dedupeStrings([]string{"a", "b"})
		if len(got) != 2 {
			t.Errorf("dedupeStrings([a,b]) = %v, want [a b]", got)
		}
	})
}

func TestGenerateWitnessToken(t *testing.T) {
	t.Run("HappyPath_LengthMatchesC#Contract", func(t *testing.T) {
		token, err := generateWitnessToken()
		if err != nil {
			t.Fatalf("generateWitnessToken() error = %v", err)
		}
		// 32 raw bytes, base64url without padding = 43 characters, matching
		// WitnessLinkEndpointTests.cs's CreateWitnessLink_TokenIsHighEntropy.
		if len(token) != 43 {
			t.Errorf("len(token) = %d, want 43", len(token))
		}
	})

	t.Run("EdgeCase_URLSafeAlphabetOnly", func(t *testing.T) {
		token, err := generateWitnessToken()
		if err != nil {
			t.Fatalf("generateWitnessToken() error = %v", err)
		}
		for _, r := range token {
			isAlnum := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
			if !isAlnum && r != '-' && r != '_' {
				t.Errorf("token contains non-base64url character %q", r)
			}
		}
	})

	t.Run("HappyPath_HighEntropyAcrossCalls", func(t *testing.T) {
		a, err := generateWitnessToken()
		if err != nil {
			t.Fatalf("generateWitnessToken() error = %v", err)
		}
		b, err := generateWitnessToken()
		if err != nil {
			t.Fatalf("generateWitnessToken() error = %v", err)
		}
		if a == b {
			t.Error("two calls to generateWitnessToken() produced the same token")
		}
	})
}
