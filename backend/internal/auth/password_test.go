package auth_test

import (
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestHashPassword_HappyPath_ProducesVerifiableHash(t *testing.T) {
	hash, err := auth.HashPassword("correctpassword")
	if err != nil {
		t.Fatalf("HashPassword() returned unexpected error: %v", err)
	}

	if !auth.VerifyPassword("correctpassword", hash) {
		t.Error("VerifyPassword() rejected a hash HashPassword just produced for the same password")
	}
}

func TestHashPassword_HappyPath_SaltsDifferentlyEachCall(t *testing.T) {
	hash1, err := auth.HashPassword("password123")
	if err != nil {
		t.Fatalf("HashPassword() returned unexpected error: %v", err)
	}
	hash2, err := auth.HashPassword("password123")
	if err != nil {
		t.Fatalf("HashPassword() returned unexpected error: %v", err)
	}

	if hash1 == hash2 {
		t.Error("HashPassword() produced identical output for two calls with the same password — salt is not random")
	}
}

func TestHashPassword_EdgeCase_ContainsExactlyOneColonSeparator(t *testing.T) {
	hash, err := auth.HashPassword("password123")
	if err != nil {
		t.Fatalf("HashPassword() returned unexpected error: %v", err)
	}

	parts := 0
	for _, c := range hash {
		if c == ':' {
			parts++
		}
	}
	if parts != 1 {
		t.Errorf("hash contains %d colons, want exactly 1 (salt:hash format)", parts)
	}
}

func TestHashPassword_EdgeCase_MinAndMaxLengthPasswords(t *testing.T) {
	minPassword := "12345678" // 8 chars, the validation floor
	hash, err := auth.HashPassword(minPassword)
	if err != nil {
		t.Fatalf("HashPassword(min-length) returned unexpected error: %v", err)
	}
	if !auth.VerifyPassword(minPassword, hash) {
		t.Error("VerifyPassword() rejected the min-length password's own hash")
	}

	maxPassword := ""
	for range 128 {
		maxPassword += "a"
	}
	hash, err = auth.HashPassword(maxPassword)
	if err != nil {
		t.Fatalf("HashPassword(max-length) returned unexpected error: %v", err)
	}
	if !auth.VerifyPassword(maxPassword, hash) {
		t.Error("VerifyPassword() rejected the max-length password's own hash")
	}
}

func TestVerifyPassword_ErrorCase_WrongPasswordRejected(t *testing.T) {
	hash, err := auth.HashPassword("correctpassword")
	if err != nil {
		t.Fatalf("HashPassword() returned unexpected error: %v", err)
	}

	if auth.VerifyPassword("wrongpassword", hash) {
		t.Error("VerifyPassword() accepted the wrong password")
	}
}

func TestVerifyPassword_ErrorCase_MalformedHashRejected(t *testing.T) {
	if auth.VerifyPassword("password", "not-a-valid-hash") {
		t.Error("VerifyPassword() accepted a malformed hash (no colon separator)")
	}
}

func TestVerifyPassword_ErrorCase_EmptyHashRejected(t *testing.T) {
	if auth.VerifyPassword("password", "") {
		t.Error("VerifyPassword() accepted an empty hash")
	}
}

func TestVerifyPassword_ErrorCase_NonBase64PartsRejected(t *testing.T) {
	if auth.VerifyPassword("password", "not-base64!!!:also-not-base64!!!") {
		t.Error("VerifyPassword() accepted a hash whose parts are not valid base64")
	}
}

func TestVerifyPassword_ErrorCase_TooManyColonsRejected(t *testing.T) {
	if auth.VerifyPassword("password", "YQ==:YQ==:YQ==") {
		t.Error("VerifyPassword() accepted a hash with more than one colon separator")
	}
}
