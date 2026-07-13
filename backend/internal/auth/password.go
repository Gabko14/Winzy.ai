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
// the DotNetHashFixture tests in password_dotnet_test.go, which verify a real
// hash captured from the running .NET auth-service.
//
// Production values live in named constants; HashPassword/VerifyPassword read
// hashingParams (initialized from those constants). Tests may retune the var
// via SetHashingParamsForTests — the constants themselves are the contract
// pinned by TestProductionHashingParamsPinned.
const (
	saltSize        = 16
	hashSize        = 32
	prodParallelism = 1
	prodMemoryKiB   = 65536 // 64 MB
	prodIterations  = 3
)

type argon2Params struct {
	parallelism uint8
	memoryKiB   uint32
	iterations  uint32
}

var hashingParams = argon2Params{
	parallelism: prodParallelism,
	memoryKiB:   prodMemoryKiB,
	iterations:  prodIterations,
}

// HashPassword returns a new Argon2id hash for password, encoded as
// "base64(salt):base64(hash)" — the exact wire format PasswordHasher.cs
// uses, since it is what's stored in the users.password_hash column today
// and must round-trip through VerifyPassword unchanged after migration.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltSize)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: generating salt: %w", err)
	}
	p := hashingParams
	hash := argon2.IDKey([]byte(password), salt, p.iterations, p.memoryKiB, p.parallelism, hashSize)
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

	p := hashingParams
	actual := argon2.IDKey([]byte(password), salt, p.iterations, p.memoryKiB, p.parallelism, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
