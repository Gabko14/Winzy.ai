package todos

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestValidateTitle_HappyPath_Accepts256RunesWithEmoji(t *testing.T) {
	title := strings.Repeat("a", 255) + "🔥"
	if utf8.RuneCountInString(title) != 256 {
		t.Fatalf("fixture rune count = %d, want 256", utf8.RuneCountInString(title))
	}
	got, err := validateTitle(title)
	if err != nil {
		t.Fatalf("validateTitle error = %v, want nil", err)
	}
	if got != title {
		t.Errorf("got %q, want same title", got)
	}
}

func TestValidateTitle_ErrorCase_Rejects257Runes(t *testing.T) {
	title := strings.Repeat("a", 257)
	if _, err := validateTitle(title); err == nil {
		t.Fatal("validateTitle should reject 257 runes")
	}
}

func TestValidateTitle_ErrorCase_RejectsEmpty(t *testing.T) {
	if _, err := validateTitle("   "); err == nil {
		t.Fatal("validateTitle should reject whitespace-only")
	}
}

func TestValidateDueDate_ErrorCase_RejectsOverflowDate(t *testing.T) {
	bad := "2026-02-30"
	if _, err := validateDueDate(&bad); err == nil {
		t.Fatal("validateDueDate should reject 2026-02-30")
	}
}

func TestOptionalDate_UnmarshalJSON_DistinguishesOmitNullAndValue(t *testing.T) {
	var omitted UpdateTodoRequest
	if err := json.Unmarshal([]byte(`{"title":"x"}`), &omitted); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if omitted.DueDate.set {
		t.Error("omitted dueDate should not be set")
	}

	var cleared UpdateTodoRequest
	if err := json.Unmarshal([]byte(`{"dueDate":null}`), &cleared); err != nil {
		t.Fatalf("unmarshal null: %v", err)
	}
	if !cleared.DueDate.set || cleared.DueDate.value != nil {
		t.Errorf("null dueDate: set=%v value=%v", cleared.DueDate.set, cleared.DueDate.value)
	}

	var valued UpdateTodoRequest
	if err := json.Unmarshal([]byte(`{"dueDate":"2026-07-20"}`), &valued); err != nil {
		t.Fatalf("unmarshal value: %v", err)
	}
	if !valued.DueDate.set || valued.DueDate.value == nil || *valued.DueDate.value != "2026-07-20" {
		t.Errorf("valued dueDate: set=%v value=%v", valued.DueDate.set, valued.DueDate.value)
	}
}
