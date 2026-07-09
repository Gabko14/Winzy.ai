package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// These parameters are COMPATIBILITY FACTS from the .NET PasswordHasher.cs
// (via Konscious.Security.Cryptography's Argon2id) and must never change
// without a migration plan: they are what makes a password hash created by
// the old stack still verify after cutover. golang.org/x/crypto/argon2's
// IDKey(password, salt, time, memory, threads, keyLen) maps directly onto
// Konscious's Iterations/MemorySize/DegreeOfParallelism/GetBytes(len) — see
// the DotNetHashFixture tests in password_test.go, which verify a real hash
// captured from the running .NET auth-service.
const (
	saltSize    = 16
	hashSize    = 32
	parallelism = 1
	memoryKiB   = 65536 // 64 MB
	iterations  = 3
)

// HashPassword returns a new Argon2id hash for password, encoded as
// "base64(salt):base64(hash)" — the exact wire format PasswordHasher.cs
// uses, since it is what's stored in the users.password_hash column today
// and must round-trip through VerifyPassword unchanged after migration.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltSize)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: generating salt: %w", err)
	}
	hash := argon2.IDKey([]byte(password), salt, iterations, memoryKiB, parallelism, hashSize)
	return base64.StdEncoding.EncodeToString(salt) + ":" + base64.StdEncoding.EncodeToString(hash), nil
}

// VerifyPassword reports whether password matches encoded, an
// Argon2id hash in the "base64(salt):base64(hash)" format produced by
// either HashPassword or the old .NET PasswordHasher. It returns false
// (never an error) for any malformed or empty encoded value, matching
// PasswordHasher.Verify's behavior.
func VerifyPassword(password, encoded string) bool {
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

	actual := argon2.IDKey([]byte(password), salt, iterations, memoryKiB, parallelism, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
