package social

import "github.com/Gabko14/winzy/backend/internal/habits"

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

// validateWitnessLabel mirrors CreateWitnessLink/UpdateWitnessLink's
// `request.Label is { Length: > 100 }` check in WitnessLinkEndpoints.cs — the
// only validation either endpoint applies to Label. C#'s string.Length
// counts UTF-16 code units, not bytes — habits.UTF16Len is the shared
// exported helper (see its doc comment) that fixes exactly this bug class
// for promise notes in winzy.ai-rdc7.3.3; counting Go's len(*label) (UTF-8
// bytes) would reject far shorter multi-byte input than the C# does.
func validateWitnessLabel(label *string) error {
	if label == nil {
		return nil
	}
	if habits.UTF16Len(*label) > maxWitnessLabelLength {
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
