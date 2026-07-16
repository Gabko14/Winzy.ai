package auth

import (
	"regexp"
	"strings"

	"unicode/utf8"
)

// usernameRegex is ported verbatim from RequestValidator.cs / AuthModels.cs.
var usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,64}$`)

// A deliberately simple, non-RFC-5322 email shape check: one "@", at least
// one "." after it, no whitespace. .NET's EmailAddressAttribute is itself a
// famously lenient, non-RFC-compliant check — this matches its spirit
// (reject obviously-not-an-email input) without attempting to replicate
// its exact internal state machine.
var emailRegex = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

const (
	maxEmailLength    = 256
	minPasswordLength = 8
	maxPasswordLength = 128
)

// validationErrors is the {"errors": {field: [messages]}} shape the
// frontend error mapper keys off (see frontend/src/api/client.ts's
// mapHttpError: it treats any body with an "errors" property as a
// validation error regardless of status code).
type validationErrors map[string][]string

// validateRegistration mirrors RequestValidator.ValidateRegistration,
// returning nil when email/username/password are all valid.
func validateRegistration(email, username, password string) validationErrors {
	errs := validationErrors{}

	trimmedEmail := strings.TrimSpace(email)
	if trimmedEmail == "" || !emailRegex.MatchString(trimmedEmail) {
		errs["email"] = []string{"A valid email address is required."}
	} else if len(trimmedEmail) > maxEmailLength {
		errs["email"] = []string{"Email must not exceed 256 characters."}
	}

	trimmedUsername := strings.TrimSpace(username)
	if trimmedUsername == "" || !usernameRegex.MatchString(trimmedUsername) {
		errs["username"] = []string{"Username must be 3-64 characters: letters, digits, hyphens, underscores only."}
	}

	passwordLength := utf8.RuneCountInString(password)
	if strings.TrimSpace(password) == "" || passwordLength < minPasswordLength {
		errs["password"] = []string{"Password must be at least 8 characters."}
	} else if passwordLength > maxPasswordLength {
		errs["password"] = []string{"Password must not exceed 128 characters."}
	}

	if len(errs) == 0 {
		return nil
	}
	return errs
}

// validateChangePassword mirrors RequestValidator.ValidateChangePassword.
func validateChangePassword(newPassword string) validationErrors {
	errs := validationErrors{}

	passwordLength := utf8.RuneCountInString(newPassword)
	if strings.TrimSpace(newPassword) == "" || passwordLength < minPasswordLength {
		errs["newPassword"] = []string{"Password must be at least 8 characters."}
	} else if passwordLength > maxPasswordLength {
		errs["newPassword"] = []string{"Password must not exceed 128 characters."}
	}

	if len(errs) == 0 {
		return nil
	}
	return errs
}
