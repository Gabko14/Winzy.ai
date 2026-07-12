package authcheck

import "testing"

func TestAuditHash_HappyPath_DotNetShape(t *testing.T) {
	// 16-byte salt + 32-byte hash, standard base64 (same shape as production).
	salt := "AAAAAAAAAAAAAAAAAAAAAA==" // 16 zero bytes
	hash := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" // 32 zero bytes
	encoded := salt + ":" + hash
	a := auditHash("demo", encoded)
	if !a.OK {
		t.Fatalf("auditHash failed: %v", a.Notes)
	}
	if a.SaltBytes != 16 || a.HashBytes != 32 {
		t.Fatalf("salt=%d hash=%d", a.SaltBytes, a.HashBytes)
	}
}

func TestAuditHash_ErrorCase_WrongPartCount(t *testing.T) {
	a := auditHash("demo", "nocolon")
	if a.OK {
		t.Fatal("expected failure for missing colon")
	}
}

func TestAuditHash_ErrorCase_BadBase64(t *testing.T) {
	a := auditHash("demo", "!!!bad!!!:also_bad==")
	if a.OK {
		t.Fatal("expected failure for bad base64")
	}
}
