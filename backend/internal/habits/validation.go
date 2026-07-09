package habits

import "strings"

const (
	maxNameLength               = 256
	maxMinimumDescriptionLength = 512
)

// fieldError is the single {"error": "message"} shape every habits endpoint
// uses — unlike internal/auth's {"errors": {field: [messages]}} dict, the
// C# source here (HabitEndpoints.cs, CompletionEndpoints.cs) never used
// Results.ValidationProblem(); every validation failure is a plain
// Results.BadRequest(new { error = "..." }). See the bead report's
// deviations section for why habits and auth genuinely have different error
// shapes rather than this being an oversight.
type fieldError struct {
	message string
}

func (e *fieldError) Error() string { return e.message }

func newFieldError(message string) error {
	return &fieldError{message: message}
}

// validateName mirrors HabitEndpoints.cs's Name checks: required,
// whitespace-only rejected, 256-char cap after trimming.
func validateName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", newFieldError("Name is required")
	}
	if len(trimmed) > maxNameLength {
		return "", newFieldError("Name must not exceed 256 characters")
	}
	return trimmed, nil
}

// validateMinimumDescriptionLength is the only check HabitEndpoints.cs
// applies to MinimumDescription — there is deliberately no corresponding
// length check on Icon/Color or range check on CustomDays elements in the
// C# source, so none is added here either (an out-of-range CustomDays value
// or an over-length Icon/Color is accepted exactly as the C# service
// accepts it, for parity — see the bead report's deviations section).
func validateMinimumDescriptionLength(desc *string) error {
	if desc == nil {
		return nil
	}
	if len(strings.TrimSpace(*desc)) > maxMinimumDescriptionLength {
		return newFieldError("MinimumDescription must not exceed 512 characters")
	}
	return nil
}
