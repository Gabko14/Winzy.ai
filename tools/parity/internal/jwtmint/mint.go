// Package jwtmint mints HS256 access tokens matching Winzy auth
// (TokenService.cs / backend/internal/auth): claims sub, email, jti, exp;
// no iss/aud. Used by parity golden-master to authenticate as existing
// users without knowing their passwords. LOCAL DEV ONLY — never point at
// production secrets or databases.
package jwtmint

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Mint returns a signed HS256 JWT for userID/email, valid for ttl.
func Mint(secret, userID, email string, ttl time.Duration) (string, error) {
	if len(secret) < 32 {
		return "", fmt.Errorf("jwtmint: secret must be at least 32 characters")
	}
	if userID == "" {
		return "", fmt.Errorf("jwtmint: userID is required")
	}
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	now := time.Now().UTC()
	jti, err := randomJTI()
	if err != nil {
		return "", err
	}
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	claims := map[string]any{
		"sub":   userID,
		"email": email,
		"jti":   jti,
		"exp":   now.Add(ttl).Unix(),
		"iat":   now.Unix(),
	}
	hb, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	cb, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signingInput := b64(hb) + "." + b64(cb)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(signingInput))
	sig := b64(mac.Sum(nil))
	return signingInput + "." + sig, nil
}

func b64(b []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(b), "=")
}

func randomJTI() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("jwtmint: generating jti: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
