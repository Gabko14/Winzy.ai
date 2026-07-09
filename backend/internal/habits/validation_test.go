package habits

import (
	"strings"
	"testing"
)

func TestValidateName_HappyPath_TrimsAndAccepts(t *testing.T) {
	name, err := validateName("  Exercise  ")
	if err != nil {
		t.Fatalf("validateName() error = %v, want nil", err)
	}
	if name != "Exercise" {
		t.Errorf("validateName() = %q, want %q", name, "Exercise")
	}
}

func TestValidateName_EdgeCase_MaxLengthAccepted(t *testing.T) {
	name := strings.Repeat("a", maxNameLength)
	if _, err := validateName(name); err != nil {
		t.Errorf("validateName() with 256-char name = %v, want nil", err)
	}
}

func TestValidateName_ErrorCase_EmptyRejected(t *testing.T) {
	if _, err := validateName(""); err == nil {
		t.Error("validateName(\"\") should return an error")
	}
}

func TestValidateName_ErrorCase_WhitespaceOnlyRejected(t *testing.T) {
	if _, err := validateName("   "); err == nil {
		t.Error("validateName(\"   \") should return an error")
	}
}

func TestValidateName_ErrorCase_TooLongRejected(t *testing.T) {
	name := strings.Repeat("a", maxNameLength+1)
	if _, err := validateName(name); err == nil {
		t.Error("validateName() with 257-char name should return an error")
	}
}

func TestValidateMinimumDescriptionLength_HappyPath_NilAccepted(t *testing.T) {
	if err := validateMinimumDescriptionLength(nil); err != nil {
		t.Errorf("validateMinimumDescriptionLength(nil) = %v, want nil", err)
	}
}

func TestValidateMinimumDescriptionLength_EdgeCase_MaxLengthAccepted(t *testing.T) {
	desc := strings.Repeat("a", maxMinimumDescriptionLength)
	if err := validateMinimumDescriptionLength(&desc); err != nil {
		t.Errorf("validateMinimumDescriptionLength() with 512-char description = %v, want nil", err)
	}
}

func TestValidateMinimumDescriptionLength_ErrorCase_TooLongRejected(t *testing.T) {
	desc := strings.Repeat("a", maxMinimumDescriptionLength+1)
	if err := validateMinimumDescriptionLength(&desc); err == nil {
		t.Error("validateMinimumDescriptionLength() with 513-char description should return an error")
	}
}

func TestParseISODate_HappyPath_ValidDateParses(t *testing.T) {
	d, ok := parseISODate("2026-03-15")
	if !ok {
		t.Fatal("parseISODate(\"2026-03-15\") ok = false, want true")
	}
	if formatISODate(d) != "2026-03-15" {
		t.Errorf("round-trip = %q, want 2026-03-15", formatISODate(d))
	}
}

func TestParseISODate_EdgeCase_LeapDayAccepted(t *testing.T) {
	if _, ok := parseISODate("2024-02-29"); !ok {
		t.Error("parseISODate(\"2024-02-29\") should accept a real leap day")
	}
}

func TestParseISODate_ErrorCase_MalformedStringRejected(t *testing.T) {
	if _, ok := parseISODate("not-a-date"); ok {
		t.Error("parseISODate(\"not-a-date\") should be rejected")
	}
}

func TestParseISODate_ErrorCase_OverflowedDayRejected(t *testing.T) {
	// Go's time.Parse alone would silently normalize Feb 30 into Mar 2
	// instead of erroring — the round-trip check in parseISODate must catch
	// this the way .NET's DateOnly.TryParse does.
	if _, ok := parseISODate("2025-02-30"); ok {
		t.Error("parseISODate(\"2025-02-30\") should be rejected (no such calendar day)")
	}
}

func TestParseISODate_ErrorCase_NonLeapYearFeb29Rejected(t *testing.T) {
	if _, ok := parseISODate("2025-02-29"); ok {
		t.Error("parseISODate(\"2025-02-29\") should be rejected (2025 is not a leap year)")
	}
}

func TestFrequency_UnmarshalJSON_HappyPath_AcceptsKnownValues(t *testing.T) {
	for _, tc := range []struct {
		wire string
		want Frequency
	}{
		{`"daily"`, FrequencyDaily},
		{`"weekly"`, FrequencyWeekly},
		{`"custom"`, FrequencyCustom},
		{`"DAILY"`, FrequencyDaily},
	} {
		var f Frequency
		if err := f.UnmarshalJSON([]byte(tc.wire)); err != nil {
			t.Errorf("Frequency.UnmarshalJSON(%s) error = %v, want nil", tc.wire, err)
			continue
		}
		if f != tc.want {
			t.Errorf("Frequency.UnmarshalJSON(%s) = %q, want %q", tc.wire, f, tc.want)
		}
	}
}

func TestFrequency_UnmarshalJSON_ErrorCase_RejectsUnknownValue(t *testing.T) {
	var f Frequency
	if err := f.UnmarshalJSON([]byte(`"biweekly"`)); err == nil {
		t.Error("Frequency.UnmarshalJSON(\"biweekly\") should return an error")
	}
}

func TestCompletionKind_ValidForLogging_HappyPathAndErrorCase(t *testing.T) {
	if !CompletionFull.validForLogging() {
		t.Error("CompletionFull.validForLogging() = false, want true")
	}
	if !CompletionMinimum.validForLogging() {
		t.Error("CompletionMinimum.validForLogging() = false, want true")
	}
	if CompletionNone.validForLogging() {
		t.Error("CompletionNone.validForLogging() = true, want false (None is well-formed but not loggable)")
	}
}

func TestCompletionKind_String_RendersLowercaseWireForm(t *testing.T) {
	if CompletionFull.String() != "full" {
		t.Errorf("CompletionFull.String() = %q, want full", CompletionFull.String())
	}
	if CompletionMinimum.String() != "minimum" {
		t.Errorf("CompletionMinimum.String() = %q, want minimum", CompletionMinimum.String())
	}
}

func TestIsValidUUID_HappyPathAndErrorCase(t *testing.T) {
	if !isValidUUID("123e4567-e89b-12d3-a456-426614174000") {
		t.Error("isValidUUID() = false for a well-formed UUID, want true")
	}
	if isValidUUID("not-a-uuid") {
		t.Error("isValidUUID() = true for a malformed string, want false")
	}
	if isValidUUID("completions") {
		t.Error("isValidUUID() = true for a literal path segment, want false")
	}
}
