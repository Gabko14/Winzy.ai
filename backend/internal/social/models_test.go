package social

import (
	"encoding/json"
	"testing"
)

func TestParseHabitVisibility(t *testing.T) {
	cases := []struct {
		name   string
		input  string
		want   HabitVisibility
		wantOK bool
	}{
		{"HappyPath_Private", "private", VisibilityPrivate, true},
		{"HappyPath_Friends", "friends", VisibilityFriends, true},
		{"HappyPath_Public", "public", VisibilityPublic, true},
		{"EdgeCase_CaseInsensitive", "PUBLIC", VisibilityPublic, true},
		{"ErrorCase_Unknown", "bogus", "", false},
		{"ErrorCase_Empty", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseHabitVisibility(tc.input)
			if ok != tc.wantOK || got != tc.want {
				t.Errorf("parseHabitVisibility(%q) = (%q, %v), want (%q, %v)", tc.input, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

func TestFriendshipStatus_String(t *testing.T) {
	if got := FriendshipPending.String(); got != "pending" {
		t.Errorf("FriendshipPending.String() = %q, want \"pending\"", got)
	}
	if got := FriendshipAccepted.String(); got != "accepted" {
		t.Errorf("FriendshipAccepted.String() = %q, want \"accepted\"", got)
	}
}

func TestFriendshipStatusFromDB(t *testing.T) {
	if got := friendshipStatusFromDB("Accepted"); got != FriendshipAccepted {
		t.Errorf("friendshipStatusFromDB(Accepted) = %q, want Accepted", got)
	}
	// EdgeCase: anything else (including garbage) defaults to Pending,
	// matching the habits module's frequencyFromDB/completionKindFromDB
	// fallback convention for an unrecognized DB value.
	if got := friendshipStatusFromDB("garbage"); got != FriendshipPending {
		t.Errorf("friendshipStatusFromDB(garbage) = %q, want Pending (fallback)", got)
	}
}

func TestHabitVisibilityFromDB(t *testing.T) {
	cases := map[string]HabitVisibility{
		"Private": VisibilityPrivate,
		"Friends": VisibilityFriends,
		"Public":  VisibilityPublic,
		"garbage": VisibilityPrivate, // ErrorCase: unrecognized value falls back to Private.
	}
	for input, want := range cases {
		if got := habitVisibilityFromDB(input); got != want {
			t.Errorf("habitVisibilityFromDB(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestHabitVisibilityValue_UnmarshalJSON(t *testing.T) {
	t.Run("HappyPath_ValidName", func(t *testing.T) {
		var v habitVisibilityValue
		if err := json.Unmarshal([]byte(`"friends"`), &v); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}
		if HabitVisibility(v) != VisibilityFriends {
			t.Errorf("v = %q, want friends", v)
		}
	})

	t.Run("ErrorCase_InvalidName", func(t *testing.T) {
		var v habitVisibilityValue
		if err := json.Unmarshal([]byte(`"not-a-visibility"`), &v); err == nil {
			t.Error("Unmarshal(invalid name) = nil error, want errInvalidVisibility")
		}
	})

	t.Run("ErrorCase_NonStringValue", func(t *testing.T) {
		var v habitVisibilityValue
		if err := json.Unmarshal([]byte(`42`), &v); err == nil {
			t.Error("Unmarshal(42) = nil error, want a decode error")
		}
	})
}

func TestFriendIDValue_UnmarshalJSON(t *testing.T) {
	t.Run("HappyPath_ValidUUID", func(t *testing.T) {
		var v friendIDValue
		if err := json.Unmarshal([]byte(`"11111111-1111-1111-1111-111111111111"`), &v); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}
		if string(v) != "11111111-1111-1111-1111-111111111111" {
			t.Errorf("v = %q, want the uuid verbatim", v)
		}
	})

	t.Run("EdgeCase_EmptyUUIDDecodesToEmpty", func(t *testing.T) {
		var v friendIDValue
		if err := json.Unmarshal([]byte(`"`+emptyUUID+`"`), &v); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}
		if v != "" {
			t.Errorf("v = %q, want empty (the all-zero UUID collapses to \"\")", v)
		}
	})

	// FIX 11 (winzy.ai-rdc7.4 review): explicit JSON null and explicit ""
	// must be DECODE FAILURES, not the "" success sentinel — only an omitted
	// field (which never calls this method — see the DTO-level test below)
	// or the literal all-zero UUID collapse to "".
	t.Run("ErrorCase_ExplicitNullIsDecodeFailure", func(t *testing.T) {
		var v friendIDValue
		if err := json.Unmarshal([]byte(`null`), &v); err == nil {
			t.Error("Unmarshal(null) = nil error, want errInvalidFriendID")
		}
	})

	t.Run("ErrorCase_ExplicitEmptyStringIsDecodeFailure", func(t *testing.T) {
		var v friendIDValue
		if err := json.Unmarshal([]byte(`""`), &v); err == nil {
			t.Error(`Unmarshal("") = nil error, want errInvalidFriendID`)
		}
	})

	t.Run("ErrorCase_MalformedUUID", func(t *testing.T) {
		var v friendIDValue
		if err := json.Unmarshal([]byte(`"not-a-uuid"`), &v); err == nil {
			t.Error("Unmarshal(not-a-uuid) = nil error, want errInvalidFriendID")
		}
	})

	t.Run("EdgeCase_OmittedFieldDecodesToEmpty", func(t *testing.T) {
		var dto friendRequestDTO
		if err := json.Unmarshal([]byte(`{}`), &dto); err != nil {
			t.Fatalf("Unmarshal({}) error = %v", err)
		}
		if dto.FriendID != "" {
			t.Errorf("FriendID = %q, want empty (an omitted field never calls UnmarshalJSON at all)", dto.FriendID)
		}
	})
}

func TestResolveVisibility(t *testing.T) {
	// FIX 12 (winzy.ai-rdc7.4 review): an omitted visibility field (zero-valued
	// habitVisibilityValue — UnmarshalJSON never ran) must resolve to Private,
	// matching C#'s non-nullable enum defaulting an omitted property to its
	// zero value rather than persisting an empty/invalid string.
	t.Run("EdgeCase_OmittedFieldResolvesToPrivate", func(t *testing.T) {
		if got := resolveVisibility(""); got != VisibilityPrivate {
			t.Errorf("resolveVisibility(\"\") = %q, want Private", got)
		}
	})
	t.Run("HappyPath_DecodedValuePassesThrough", func(t *testing.T) {
		if got := resolveVisibility(habitVisibilityValue(VisibilityPublic)); got != VisibilityPublic {
			t.Errorf("resolveVisibility(Public) = %q, want Public", got)
		}
	})
}

func TestHabitIDList_UnmarshalJSON(t *testing.T) {
	// FIX 4 (winzy.ai-rdc7.4 review): a non-UUID array element must be a
	// decode failure — previously it reached the `$2::uuid` cast and
	// produced a raw Postgres error mapped to 500 instead of 400.
	t.Run("HappyPath_ValidUUIDs", func(t *testing.T) {
		var h habitIDList
		if err := json.Unmarshal([]byte(`["11111111-1111-1111-1111-111111111111","22222222-2222-2222-2222-222222222222"]`), &h); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}
		if len(h) != 2 {
			t.Errorf("h = %v, want 2 ids", h)
		}
	})

	t.Run("ErrorCase_NonUUIDElement", func(t *testing.T) {
		var h habitIDList
		if err := json.Unmarshal([]byte(`["garbage"]`), &h); err == nil {
			t.Error(`Unmarshal(["garbage"]) = nil error, want errInvalidHabitID`)
		}
	})

	t.Run("EdgeCase_EmptyArrayDecodesToEmptyNonNil", func(t *testing.T) {
		var h habitIDList
		if err := json.Unmarshal([]byte(`[]`), &h); err != nil {
			t.Fatalf("Unmarshal([]) error = %v", err)
		}
		if h == nil || len(h) != 0 {
			t.Errorf("h = %v, want an empty (non-nil) slice", h)
		}
	})

	t.Run("EdgeCase_NullDecodesToNil", func(t *testing.T) {
		var h habitIDList
		if err := json.Unmarshal([]byte(`null`), &h); err != nil {
			t.Fatalf("Unmarshal(null) error = %v", err)
		}
		if h != nil {
			t.Errorf("h = %v, want nil (the \"leave allowlist / no habits selected\" signal)", h)
		}
	})

	t.Run("EdgeCase_OmittedFieldDecodesToNil", func(t *testing.T) {
		var dto witnessLinkCreateDTO
		if err := json.Unmarshal([]byte(`{}`), &dto); err != nil {
			t.Fatalf("Unmarshal({}) error = %v", err)
		}
		if dto.HabitIDs != nil {
			t.Errorf("HabitIDs = %v, want nil", dto.HabitIDs)
		}
	})
}
