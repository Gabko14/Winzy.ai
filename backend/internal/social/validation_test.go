package social

import (
	"strings"
	"testing"
)

func TestValidateWitnessLabel(t *testing.T) {
	t.Run("HappyPath_NilIsValid", func(t *testing.T) {
		if err := validateWitnessLabel(nil); err != nil {
			t.Errorf("validateWitnessLabel(nil) = %v, want nil", err)
		}
	})

	t.Run("EdgeCase_ExactlyMaxLengthIsValid", func(t *testing.T) {
		label := strings.Repeat("x", maxWitnessLabelLength)
		if err := validateWitnessLabel(&label); err != nil {
			t.Errorf("validateWitnessLabel(100 chars) = %v, want nil", err)
		}
	})

	t.Run("ErrorCase_OverMaxLengthRejected", func(t *testing.T) {
		label := strings.Repeat("x", maxWitnessLabelLength+1)
		err := validateWitnessLabel(&label)
		if err == nil {
			t.Fatal("validateWitnessLabel(101 chars) = nil, want an error")
		}
		if got := err.Error(); got != "Label must be 100 characters or fewer" {
			t.Errorf("error = %q, want the C#-matching message", got)
		}
	})
}

func TestValidateWitnessHabitCount(t *testing.T) {
	t.Run("HappyPath_EmptyIsValid", func(t *testing.T) {
		if err := validateWitnessHabitCount(nil); err != nil {
			t.Errorf("validateWitnessHabitCount(nil) = %v, want nil", err)
		}
	})

	t.Run("EdgeCase_ExactlyMaxCountIsValid", func(t *testing.T) {
		ids := make([]string, maxWitnessLinkHabits)
		if err := validateWitnessHabitCount(ids); err != nil {
			t.Errorf("validateWitnessHabitCount(50 ids) = %v, want nil", err)
		}
	})

	t.Run("ErrorCase_OverMaxCountRejected", func(t *testing.T) {
		ids := make([]string, maxWitnessLinkHabits+1)
		if err := validateWitnessHabitCount(ids); err == nil {
			t.Error("validateWitnessHabitCount(51 ids) = nil, want an error")
		}
	})
}
