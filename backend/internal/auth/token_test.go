package auth_test

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

const testSecret = "test-secret-key-that-is-at-least-32-characters-long!!"
const testUserID = "11111111-1111-1111-1111-111111111111"

func TestNewTokenService_HappyPath_AcceptsValidSecret(t *testing.T) {
	if _, err := auth.NewTokenService(testSecret, 15, 7); err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}
}

func TestNewTokenService_EdgeCase_AcceptsExactly32CharSecret(t *testing.T) {
	secret := strings.Repeat("a", 32)
	if _, err := auth.NewTokenService(secret, 15, 7); err != nil {
		t.Errorf("NewTokenService() with exactly 32 chars returned unexpected error: %v", err)
	}
}

func TestNewTokenService_ErrorCase_RejectsMissingSecret(t *testing.T) {
	_, err := auth.NewTokenService("", 15, 7)
	if err == nil {
		t.Fatal("NewTokenService(\"\", ...) should return an error")
	}
	if !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Errorf("error %q should mention JWT_SECRET", err.Error())
	}
}

func TestNewTokenService_ErrorCase_RejectsWhitespaceOnlySecret(t *testing.T) {
	for _, secret := range []string{" ", "\t", "   "} {
		if _, err := auth.NewTokenService(secret, 15, 7); err == nil {
			t.Errorf("NewTokenService(%q, ...) should return an error", secret)
		}
	}
}

func TestNewTokenService_ErrorCase_RejectsTooShortSecret(t *testing.T) {
	_, err := auth.NewTokenService(strings.Repeat("x", 31), 15, 7)
	if err == nil {
		t.Fatal("NewTokenService() with a 31-char secret should return an error")
	}
	if !strings.Contains(err.Error(), "32") {
		t.Errorf("error %q should mention the minimum length", err.Error())
	}
}

func TestNewTokenService_ErrorCase_RejectsKnownPlaceholders(t *testing.T) {
	for _, placeholder := range []string{"your-secret-key", "change-me", "secret", "placeholder", "your-jwt-secret"} {
		if _, err := auth.NewTokenService(placeholder, 15, 7); err == nil {
			t.Errorf("NewTokenService(%q, ...) should return an error (known placeholder)", placeholder)
		}
	}
}

func TestNewTokenService_ErrorCase_RejectsLongPlaceholderCaseInsensitively(t *testing.T) {
	const legacy = "CHANGE-THIS-IN-PRODUCTION-minimum-32-characters-long"
	if len(legacy) < 32 {
		t.Fatal("test fixture assumption broken: legacy placeholder must be >= 32 chars")
	}
	if _, err := auth.NewTokenService(legacy, 15, 7); err == nil {
		t.Error("NewTokenService() should reject a >=32-char placeholder")
	}

	for _, secret := range []string{"YOUR-SECRET-KEY", "CHANGE-ME", "SECRET"} {
		if _, err := auth.NewTokenService(secret, 15, 7); err == nil {
			t.Errorf("NewTokenService(%q, ...) should reject placeholders case-insensitively", secret)
		}
	}
}

func TestGenerateAccessToken_HappyPath_ContainsExpectedClaims(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}

	token, err := svc.GenerateAccessToken(testUserID, "test@example.com")
	if err != nil {
		t.Fatalf("GenerateAccessToken() returned unexpected error: %v", err)
	}
	if token == "" {
		t.Fatal("GenerateAccessToken() returned an empty token")
	}

	parsed, _, err := jwt.NewParser().ParseUnverified(token, jwt.MapClaims{})
	if err != nil {
		t.Fatalf("parsing generated token failed: %v", err)
	}
	claims := parsed.Claims.(jwt.MapClaims)

	if claims["sub"] != testUserID {
		t.Errorf("sub claim = %v, want %s", claims["sub"], testUserID)
	}
	if claims["email"] != "test@example.com" {
		t.Errorf("email claim = %v, want test@example.com", claims["email"])
	}
	if _, ok := claims["jti"]; !ok {
		t.Error("jti claim missing")
	}
	if _, ok := claims["iss"]; ok {
		t.Error("iss claim must not be present (matches TokenService.cs disabling issuer validation)")
	}
	if _, ok := claims["aud"]; ok {
		t.Error("aud claim must not be present (matches TokenService.cs disabling audience validation)")
	}
}

func TestGenerateAccessToken_HappyPath_ExpiresAtConfiguredLifetime(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}

	token, err := svc.GenerateAccessToken(testUserID, "test@example.com")
	if err != nil {
		t.Fatalf("GenerateAccessToken() returned unexpected error: %v", err)
	}

	parsed, _, err := jwt.NewParser().ParseUnverified(token, jwt.MapClaims{})
	if err != nil {
		t.Fatalf("parsing generated token failed: %v", err)
	}
	claims := parsed.Claims.(jwt.MapClaims)
	exp, err := claims.GetExpirationTime()
	if err != nil {
		t.Fatalf("reading exp claim failed: %v", err)
	}

	wantExpiry := time.Now().Add(15 * time.Minute)
	if diff := exp.Sub(wantExpiry); diff < -30*time.Second || diff > 30*time.Second {
		t.Errorf("exp = %v, want within 30s of %v", exp, wantExpiry)
	}
}

func TestGenerateRefreshToken_HappyPath_Returns64RandomBytesBase64Encoded(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}

	token, err := svc.GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken() returned unexpected error: %v", err)
	}

	decoded, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		t.Fatalf("GenerateRefreshToken() output is not valid base64: %v", err)
	}
	if len(decoded) != 64 {
		t.Errorf("decoded refresh token is %d bytes, want 64", len(decoded))
	}
}

func TestGenerateRefreshToken_HappyPath_ReturnsUniqueTokens(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}

	token1, err := svc.GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken() returned unexpected error: %v", err)
	}
	token2, err := svc.GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken() returned unexpected error: %v", err)
	}

	if token1 == token2 {
		t.Error("two calls to GenerateRefreshToken() produced identical tokens")
	}
}

func TestRefreshTokenLifetime_HappyPath_ReturnsConfiguredDays(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 14)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}

	if got := svc.RefreshTokenLifetime(); got != 14*24*time.Hour {
		t.Errorf("RefreshTokenLifetime() = %v, want %v", got, 14*24*time.Hour)
	}
}

func TestValidateAccessToken_HappyPath_ReturnsUserIDForValidToken(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}

	token, err := svc.GenerateAccessToken(testUserID, "test@example.com")
	if err != nil {
		t.Fatalf("GenerateAccessToken() returned unexpected error: %v", err)
	}

	userID, err := svc.ValidateAccessToken(token)
	if err != nil {
		t.Fatalf("ValidateAccessToken() returned unexpected error: %v", err)
	}
	if userID != testUserID {
		t.Errorf("ValidateAccessToken() = %q, want %s", userID, testUserID)
	}
}

func TestValidateAccessToken_ErrorCase_RejectsGarbageToken(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}

	if _, err := svc.ValidateAccessToken("invalid.token.here"); err == nil {
		t.Error("ValidateAccessToken() should reject a garbage token")
	}
}

func TestValidateAccessToken_ErrorCase_RejectsExpiredToken(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 0, 7) // 0-minute lifetime: expires immediately
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}

	token, err := svc.GenerateAccessToken(testUserID, "test@example.com")
	if err != nil {
		t.Fatalf("GenerateAccessToken() returned unexpected error: %v", err)
	}

	time.Sleep(10 * time.Millisecond)

	if _, err := svc.ValidateAccessToken(token); err == nil {
		t.Error("ValidateAccessToken() should reject an expired token")
	}
}

func TestValidateAccessToken_ErrorCase_RejectsTokenSignedWithDifferentSecret(t *testing.T) {
	svc1, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}
	svc2, err := auth.NewTokenService(strings.Repeat("b", 40), 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}

	token, err := svc1.GenerateAccessToken(testUserID, "test@example.com")
	if err != nil {
		t.Fatalf("GenerateAccessToken() returned unexpected error: %v", err)
	}

	if _, err := svc2.ValidateAccessToken(token); err == nil {
		t.Error("ValidateAccessToken() should reject a token signed with a different secret")
	}
}

func TestValidateAccessToken_ErrorCase_RejectsEmptyToken(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}

	if _, err := svc.ValidateAccessToken(""); err == nil {
		t.Error("ValidateAccessToken() should reject an empty token")
	}
}

func TestValidateAccessToken_ErrorCase_RejectsHS512(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS512, jwt.MapClaims{
		"sub": testUserID,
		"exp": time.Now().Add(time.Minute).Unix(),
	})
	signed, err := token.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signing HS512 fixture: %v", err)
	}
	if _, err := svc.ValidateAccessToken(signed); err == nil {
		t.Error("ValidateAccessToken() should reject HS512 even with the correct key")
	}
}

func TestValidateAccessToken_ErrorCase_RejectsMissingExpiration(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": testUserID})
	signed, err := token.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signing no-exp fixture: %v", err)
	}
	if _, err := svc.ValidateAccessToken(signed); err == nil {
		t.Error("ValidateAccessToken() should reject a token without exp")
	}
}

func TestValidateAccessToken_ErrorCase_RejectsMissingOrMalformedSubject(t *testing.T) {
	svc, err := auth.NewTokenService(testSecret, 15, 7)
	if err != nil {
		t.Fatalf("NewTokenService() returned unexpected error: %v", err)
	}
	for _, subject := range []string{"", "not-a-uuid"} {
		t.Run(subject, func(t *testing.T) {
			token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
				"sub": subject,
				"exp": time.Now().Add(time.Minute).Unix(),
			})
			signed, err := token.SignedString([]byte(testSecret))
			if err != nil {
				t.Fatalf("signing malformed-sub fixture: %v", err)
			}
			if _, err := svc.ValidateAccessToken(signed); err == nil {
				t.Errorf("ValidateAccessToken() should reject sub %q", subject)
			}
		})
	}
}
