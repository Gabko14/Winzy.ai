package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"strings"
	"testing"

	"golang.org/x/crypto/argon2"
)

func TestProductionHashingParamsPinned(t *testing.T) {
	t.Parallel()
	if prodParallelism != 1 {
		t.Fatalf("prodParallelism = %d, want 1", prodParallelism)
	}
	if prodMemoryKiB != 65536 {
		t.Fatalf("prodMemoryKiB = %d, want 65536", prodMemoryKiB)
	}
	if prodIterations != 3 {
		t.Fatalf("prodIterations = %d, want 3", prodIterations)
	}

	const password = "pin-test-password"
	salt := make([]byte, saltSize)
	if _, err := rand.Read(salt); err != nil {
		t.Fatalf("generating salt: %v", err)
	}

	hash := argon2.IDKey([]byte(password), salt, prodIterations, prodMemoryKiB, prodParallelism, hashSize)
	encoded := base64.StdEncoding.EncodeToString(salt) + ":" + base64.StdEncoding.EncodeToString(hash)

	parts := strings.Split(encoded, ":")
	if len(parts) != 2 {
		t.Fatalf("encoded hash has %d parts, want 2 (base64(salt16):base64(hash32))", len(parts))
	}
	gotSalt, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		t.Fatalf("salt part is not valid base64: %v", err)
	}
	gotHash, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("hash part is not valid base64: %v", err)
	}
	if len(gotSalt) != saltSize {
		t.Fatalf("salt length = %d, want %d", len(gotSalt), saltSize)
	}
	if len(gotHash) != hashSize {
		t.Fatalf("hash length = %d, want %d", len(gotHash), hashSize)
	}

	actual := argon2.IDKey([]byte(password), gotSalt, prodIterations, prodMemoryKiB, prodParallelism, uint32(len(gotHash)))
	if subtle.ConstantTimeCompare(actual, gotHash) != 1 {
		t.Fatal("production-constant hash+verify round-trip failed")
	}
	if subtle.ConstantTimeCompare(
		argon2.IDKey([]byte("wrong-password"), gotSalt, prodIterations, prodMemoryKiB, prodParallelism, uint32(len(gotHash))),
		gotHash,
	) == 1 {
		t.Fatal("production-constant verify accepted the wrong password")
	}
}
