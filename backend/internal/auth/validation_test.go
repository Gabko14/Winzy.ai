package auth

import (
	"strings"
	"testing"
)

func TestValidateRegistration_HappyPath_ValidInputReturnsNil(t *testing.T) {
	t.Parallel()
	if errs := validateRegistration("user@example.com", "validuser", "Password123!"); errs != nil {
		t.Errorf("validateRegistration() = %v, want nil for valid input", errs)
	}
}

func TestValidateRegistration_EdgeCase_TrimsWhitespaceBeforeValidating(t *testing.T) {
	t.Parallel()
	if errs := validateRegistration("  user@example.com  ", "  validuser  ", "Password123!"); errs != nil {
		t.Errorf("validateRegistration() = %v, want nil (whitespace should be trimmed)", errs)
	}
}

func TestValidateRegistration_EdgeCase_MinAndMaxLengthPasswordAccepted(t *testing.T) {
	t.Parallel()
	if errs := validateRegistration("user@example.com", "validuser", "12345678"); errs != nil {
		t.Errorf("validateRegistration() with 8-char password = %v, want nil", errs)
	}
	if errs := validateRegistration("user@example.com", "validuser", strings.Repeat("a", 128)); errs != nil {
		t.Errorf("validateRegistration() with 128-char password = %v, want nil", errs)
	}
}

func TestValidateRegistration_EdgeCase_MinAndMaxLengthUsernameAccepted(t *testing.T) {
	t.Parallel()
	if errs := validateRegistration("user@example.com", "abc", "Password123!"); errs != nil {
		t.Errorf("validateRegistration() with 3-char username = %v, want nil", errs)
	}
	if errs := validateRegistration("user@example.com", strings.Repeat("a", 64), "Password123!"); errs != nil {
		t.Errorf("validateRegistration() with 64-char username = %v, want nil", errs)
	}
}

func TestValidateRegistration_ErrorCase_InvalidEmailRejected(t *testing.T) {
	t.Parallel()
	errs := validateRegistration("not-an-email", "validuser", "Password123!")
	if errs == nil || errs["email"] == nil {
		t.Errorf("validateRegistration() = %v, want an email error", errs)
	}
}

func TestValidateRegistration_ErrorCase_EmailTooLongRejected(t *testing.T) {
	t.Parallel()
	longLocal := strings.Repeat("a", 250)
	errs := validateRegistration(longLocal+"@example.com", "validuser", "Password123!")
	if errs == nil || errs["email"] == nil {
		t.Errorf("validateRegistration() = %v, want an email error for an over-length address", errs)
	}
}

func TestValidateRegistration_ErrorCase_UsernameTooShortRejected(t *testing.T) {
	t.Parallel()
	errs := validateRegistration("user@example.com", "ab", "Password123!")
	if errs == nil || errs["username"] == nil {
		t.Errorf("validateRegistration() = %v, want a username error", errs)
	}
}

func TestValidateRegistration_ErrorCase_UsernameWithInvalidCharsRejected(t *testing.T) {
	t.Parallel()
	errs := validateRegistration("user@example.com", "invalid user!", "Password123!")
	if errs == nil || errs["username"] == nil {
		t.Errorf("validateRegistration() = %v, want a username error for invalid characters", errs)
	}
}

func TestValidateRegistration_ErrorCase_ShortPasswordRejected(t *testing.T) {
	t.Parallel()
	errs := validateRegistration("user@example.com", "validuser", "short")
	if errs == nil || errs["password"] == nil {
		t.Errorf("validateRegistration() = %v, want a password error", errs)
	}
}

func TestValidateRegistration_ErrorCase_TooLongPasswordRejected(t *testing.T) {
	t.Parallel()
	errs := validateRegistration("user@example.com", "validuser", strings.Repeat("a", 129))
	if errs == nil || errs["password"] == nil {
		t.Errorf("validateRegistration() = %v, want a password error for over-length password", errs)
	}
}

func TestValidateRegistration_EdgeCase_PasswordLengthCountsRunes(t *testing.T) {
	t.Parallel()
	// "1234567😀" is 8 runes (12 UTF-8 bytes) — a byte-length check would
	// mis-measure multi-byte input; rune count is the character count.
	if errs := validateRegistration("user@example.com", "validuser", "1234567😀"); errs != nil {
		t.Errorf("8-rune password = %v, want accepted", errs)
	}
	password := strings.Repeat("a", 128) + "😀"
	errs := validateRegistration("user@example.com", "validuser", password)
	if errs == nil || errs["password"] == nil {
		t.Errorf("129-rune password = %v, want rejected", errs)
	}
}

func TestValidateRegistration_ErrorCase_WhitespaceOnlyPasswordRejected(t *testing.T) {
	t.Parallel()
	errs := validateRegistration("user@example.com", "validuser", "        ")
	if errs == nil || errs["password"] == nil {
		t.Errorf("whitespace-only password = %v, want rejected", errs)
	}
}

func TestValidateRegistration_ErrorCase_MultipleFieldsCanFailAtOnce(t *testing.T) {
	t.Parallel()
	errs := validateRegistration("not-an-email", "x", "short")
	if errs == nil {
		t.Fatal("validateRegistration() should return errors")
	}
	if errs["email"] == nil || errs["username"] == nil || errs["password"] == nil {
		t.Errorf("validateRegistration() = %v, want all three fields to have errors", errs)
	}
}

func TestValidateChangePassword_HappyPath_ValidPasswordReturnsNil(t *testing.T) {
	t.Parallel()
	if errs := validateChangePassword("NewPassword1!"); errs != nil {
		t.Errorf("validateChangePassword() = %v, want nil", errs)
	}
}

func TestValidateChangePassword_ErrorCase_ShortPasswordRejected(t *testing.T) {
	t.Parallel()
	errs := validateChangePassword("short")
	if errs == nil || errs["newPassword"] == nil {
		t.Errorf("validateChangePassword() = %v, want a newPassword error", errs)
	}
}

func TestValidateChangePassword_ErrorCase_TooLongPasswordRejected(t *testing.T) {
	t.Parallel()
	errs := validateChangePassword(strings.Repeat("a", 129))
	if errs == nil || errs["newPassword"] == nil {
		t.Errorf("validateChangePassword() = %v, want a newPassword error", errs)
	}
}

func TestValidateChangePassword_ErrorCase_WhitespaceOnlyPasswordRejected(t *testing.T) {
	t.Parallel()
	errs := validateChangePassword("        ")
	if errs == nil || errs["newPassword"] == nil {
		t.Errorf("whitespace-only new password = %v, want rejected", errs)
	}
}
