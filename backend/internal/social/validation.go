package social

import "unicode/utf8"

// fieldError is the single {"error": "message"} shape every social endpoint
// uses, matching FriendEndpoints.cs/VisibilityEndpoints.cs/
// WitnessLinkEndpoints.cs — every validation failure there is a plain
// Results.BadRequest(new { error = "..." }), the same convention
// habits.fieldError documents (see that type's doc comment for why habits
// and auth genuinely differ here; social follows habits).
type fieldError struct {
	message string
}

func (e *fieldError) Error() string { return e.message }

func newFieldError(message string) error {
	return &fieldError{message: message}
}

const maxWitnessLabelLength = 100

// validateWitnessLabel enforces the 100-character label limit — counted in
// runes, not bytes, so multi-byte input isn't unfairly truncated.
func validateWitnessLabel(label *string) error {
	if label == nil {
		return nil
	}
	if utf8.RuneCountInString(*label) > maxWitnessLabelLength {
		return newFieldError("Label must be 100 characters or fewer")
	}
	return nil
}

const maxWitnessLinkHabits = 50

// validateWitnessHabitCount mirrors both endpoints' `request.HabitIds.Count
// > 50` check.
func validateWitnessHabitCount(habitIDs []string) error {
	if len(habitIDs) > maxWitnessLinkHabits {
		return newFieldError("Maximum 50 habits per witness link.")
	}
	return nil
}
