package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/Gabko14/winzy/backend/internal/reqid"
)

const minSecretLength = 32

// jwtSecretPlaceholders is ported verbatim from TokenService.cs — a secret
// equal (case-insensitively) to any of these is rejected even if it is
// otherwise long enough, since these are exactly the values a developer
// might leave in place by accident.
var jwtSecretPlaceholders = []string{
	"your-secret-key",
	"your-jwt-secret",
	"change-me",
	"secret",
	"placeholder",
	"change-this-in-production-minimum-32-characters-long",
}

// TokenService issues and validates access tokens and generates opaque
// refresh tokens, matching TokenService.cs: HS256, no iss/aud, sub=userId,
// jti=random UUID, zero clock skew (jwt/v5's parser applies zero leeway by
// default, so no WithLeeway option is needed here).
type TokenService struct {
	secret               []byte
	accessTokenLifetime  time.Duration
	refreshTokenLifetime time.Duration
}

// NewTokenService validates secret against the same rules
// TokenService.cs's constructor enforces (non-empty, >=32 chars, not a
// known placeholder) and returns an error describing exactly which check
// failed — callers (cmd/api/main.go) should treat that error as fatal at
// startup, the same way a bad JWT_SECRET crashed the old auth-service.
func NewTokenService(secret string, accessTokenMinutes, refreshTokenDays int) (*TokenService, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, fmt.Errorf("auth: JWT_SECRET is not configured. Set it via the JWT_SECRET environment variable")
	}
	if len(secret) < minSecretLength {
		return nil, fmt.Errorf("auth: JWT_SECRET must be at least %d characters for HMAC-SHA256. Current length: %d",
			minSecretLength, len(secret))
	}

	lower := strings.ToLower(secret)
	for _, placeholder := range jwtSecretPlaceholders {
		if lower == placeholder {
			return nil, fmt.Errorf("auth: JWT_SECRET is still set to a placeholder value. Set a real secret before starting the service")
		}
	}

	return &TokenService{
		secret:               []byte(secret),
		accessTokenLifetime:  time.Duration(accessTokenMinutes) * time.Minute,
		refreshTokenLifetime: time.Duration(refreshTokenDays) * 24 * time.Hour,
	}, nil
}

// RefreshTokenLifetime is exported so the store layer can compute an
// ExpiresAt when persisting a new refresh token.
func (s *TokenService) RefreshTokenLifetime() time.Duration {
	return s.refreshTokenLifetime
}

// accessClaims mirrors the JWT claim set TokenService.cs issues: sub
// (userId), email (custom claim), jti (via RegisteredClaims.ID), exp — and
// deliberately no iss/aud, since the old service disabled their validation.
type accessClaims struct {
	Email string `json:"email"`
	jwt.RegisteredClaims
}

// GenerateAccessToken returns a signed HS256 JWT for userID/email, expiring
// after the configured access token lifetime (default 15 minutes).
func (s *TokenService) GenerateAccessToken(userID, email string) (string, error) {
	now := time.Now().UTC()
	claims := accessClaims{
		Email: email,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ID:        reqid.New(), // a random v4 UUID; reused rather than adding a UUID dependency
			ExpiresAt: jwt.NewNumericDate(now.Add(s.accessTokenLifetime)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.secret)
	if err != nil {
		return "", fmt.Errorf("auth: signing access token: %w", err)
	}
	return signed, nil
}

// GenerateRefreshToken returns a base64-encoded opaque 64-byte random
// token, matching TokenService.cs's GenerateRefreshToken exactly (same
// byte length, same encoding).
func (s *TokenService) GenerateRefreshToken() (string, error) {
	b := make([]byte, 64)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: generating refresh token: %w", err)
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// ValidateAccessToken parses and validates token, returning the userID
// (the sub claim) on success. Any parse failure, bad signature, wrong
// signing method, or expired token returns an error — there is no partial
// success.
func (s *TokenService) ValidateAccessToken(token string) (string, error) {
	claims := &accessClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("auth: unexpected signing method %v", t.Header["alg"])
		}
		return s.secret, nil
	})
	if err != nil {
		return "", fmt.Errorf("auth: invalid access token: %w", err)
	}
	if !parsed.Valid {
		return "", fmt.Errorf("auth: invalid access token")
	}
	return claims.Subject, nil
}
