package activity

import "testing"

func TestVisibilityRank_HappyPath_Ordering(t *testing.T) {
	if visibilityRank("public") <= visibilityRank("friends") {
		t.Errorf("public should rank above friends")
	}
	if visibilityRank("friends") <= visibilityRank("private") {
		t.Errorf("friends should rank above private")
	}
}

func TestIsNarrowing_HappyPath_PublicToPrivate(t *testing.T) {
	if !isNarrowing("public", "private") {
		t.Fatal("public→private should be narrowing")
	}
	if !isNarrowing("Friends", "Private") {
		t.Fatal("Friends→Private should be narrowing (case-insensitive)")
	}
}

func TestIsWidening_HappyPath_PrivateToFriends(t *testing.T) {
	if !isWidening("private", "friends") {
		t.Fatal("private→friends should be widening")
	}
	if isWidening("public", "friends") {
		t.Fatal("public→friends should not be widening")
	}
}

func TestIsNarrowing_EdgeCase_SameRank(t *testing.T) {
	if isNarrowing("friends", "friends") {
		t.Fatal("same visibility should not be narrowing")
	}
	if isWidening("private", "private") {
		t.Fatal("same visibility should not be widening")
	}
}

func TestFriendshipPairKey_HappyPath_CanonicalOrder(t *testing.T) {
	a := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	b := "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	if friendshipPairKey(a, b) != a+":"+b {
		t.Errorf("pair key = %q, want lexicographic order", friendshipPairKey(a, b))
	}
	if friendshipPairKey(b, a) != a+":"+b {
		t.Errorf("pair key must be order-independent")
	}
}

func TestHabitIDFromData_HappyPath_AndErrors(t *testing.T) {
	id, ok := habitIDFromData([]byte(`{"habitId":"h1","name":"x"}`))
	if !ok || id != "h1" {
		t.Errorf("got %q/%v, want h1/true", id, ok)
	}
	if _, ok := habitIDFromData([]byte(`{`)); ok {
		t.Error("malformed JSON should fail")
	}
	if _, ok := habitIDFromData([]byte(`{"name":"x"}`)); ok {
		t.Error("missing habitId should fail")
	}
	if _, ok := habitIDFromData(nil); ok {
		t.Error("nil data should fail")
	}
}

func TestDedupe_EdgeCase_EmptyAndDuplicates(t *testing.T) {
	if got := dedupe(nil); len(got) != 0 {
		t.Errorf("dedupe(nil) = %v", got)
	}
	got := dedupe([]string{"a", "b", "a", "c", "b"})
	if len(got) != 3 || got[0] != "a" || got[1] != "b" || got[2] != "c" {
		t.Errorf("dedupe = %v, want [a b c]", got)
	}
}
