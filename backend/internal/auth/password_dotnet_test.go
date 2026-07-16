package auth

import (
	"crypto/subtle"
	"encoding/base64"
	"strings"
	"testing"

	"golang.org/x/crypto/argon2"
)

func TestVerifyPassword_HappyPath_DotNetHashFixtureVerifies(t *testing.T) {
	t.Parallel()
	// CRITICAL COMPATIBILITY FIXTURE (winzy.ai-rdc7.2 acceptance criterion):
	// captured 2026-07-09 from a real, running .NET auth-service (image
	// winzyai-auth-service, commit at HEAD of this bead) by registering a
	// throwaway user (docker compose up -d nats auth-db auth-service; POST
	// /auth/register from inside the auth-service container, since 5001 is
	// docker-compose "expose"-only, not host-published) and reading
	// password_hash straight out of auth_db via psql. This is NOT a
	// synthetic value — it is the literal Konscious.Security.Cryptography
	// Argon2id output for the plaintext below, and existing users' hashes
	// MUST verify unchanged through this Go implementation after cutover.
	//
	// Uses prod* constants directly (not hashingParams) so the fixture stays
	// valid when TestMain retunes hashingParams for speed (winzy.ai-o5cd).
	const plaintext = "FixturePass123!"
	const dotNetHash = "D7aY9nV9OroRI/DSVjBW6w==:Ust5748ZwCat5YuaGkDi2d/XdSMnMh30hzHJpVRy1zo="

	if !verifyWithProductionParams(plaintext, dotNetHash) {
		t.Fatal("a hash produced by the .NET Argon2id implementation failed to verify in Go — " +
			"check argon2.IDKey's time/memory/threads/keyLen parameters against PasswordHasher.cs")
	}
}

func TestVerifyPassword_ErrorCase_DotNetHashFixtureRejectsWrongPassword(t *testing.T) {
	t.Parallel()
	const dotNetHash = "D7aY9nV9OroRI/DSVjBW6w==:Ust5748ZwCat5YuaGkDi2d/XdSMnMh30hzHJpVRy1zo="

	if verifyWithProductionParams("WrongPassword!", dotNetHash) {
		t.Fatal("production-param verify accepted the wrong password against a real .NET-produced hash")
	}
}

func verifyWithProductionParams(password, encoded string) bool {
	parts := strings.Split(encoded, ":")
	if len(parts) != 2 {
		return false
	}
	salt, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	expected, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, prodIterations, prodMemoryKiB, prodParallelism, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
