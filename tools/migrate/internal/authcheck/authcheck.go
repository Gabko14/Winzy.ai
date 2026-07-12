// Package authcheck audits migrated password hashes against the same
// Argon2id parameters as backend/internal/auth (winzy.ai-rdc7.9 step 6).
//
// Go's internal/ visibility rule prevents importing backend/internal/auth
// from tools/migrate; verifyPassword here is kept byte-compatible with
// backend/internal/auth/password.go (same salt/hash sizes and argon2 params).
//
// No owner-username guessing: every migrated user gets a format + params
// audit and a PLACEHOLDER password rejection check. Real login is the
// owner spot-check later.
package authcheck

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"

	"winzy.ai/migrate/internal/config"
)

// Mirrored from backend/internal/auth/password.go — do not drift.
const (
	saltSize    = 16
	hashSize    = 32
	parallelism = 1
	memoryKiB   = 65536
	iterations  = 3
	placeholder = "PLACEHOLDER"
)

// UserAudit is one user's password_hash format audit.
type UserAudit struct {
	Username       string
	OK             bool
	Parts          int
	SaltBytes      int
	HashBytes      int
	Notes          []string
	PlaceholderRej bool
}

// Result is the auth-chain proof section.
type Result struct {
	Users    []UserAudit
	OK       bool
	Failures []string
}

// Run audits every migrated user's hash format and exercises verifyPassword
// with a PLACEHOLDER password (must reject for every user).
func Run(ctx context.Context, cfg config.Config) (*Result, error) {
	pool, err := pgxpool.New(ctx, cfg.TargetURL())
	if err != nil {
		return nil, fmt.Errorf("authcheck: connect: %w", err)
	}
	defer pool.Close()

	rows, err := pool.Query(ctx, `SELECT username, password_hash FROM users ORDER BY username`)
	if err != nil {
		return nil, fmt.Errorf("authcheck: query users: %w", err)
	}
	defer rows.Close()

	res := &Result{}
	for rows.Next() {
		var username, hash string
		if err := rows.Scan(&username, &hash); err != nil {
			return nil, err
		}
		a := auditHash(username, hash)
		rejected := !verifyPassword(placeholder, hash)
		a.PlaceholderRej = rejected
		if !rejected {
			a.OK = false
			a.Notes = append(a.Notes, "VerifyPassword(PLACEHOLDER) unexpectedly returned true")
		} else {
			a.Notes = append(a.Notes, "VerifyPassword(PLACEHOLDER) returned false (parseable; wrong password rejected)")
		}
		res.Users = append(res.Users, a)
		if !a.OK {
			res.Failures = append(res.Failures, fmt.Sprintf("user %q hash audit failed: %s", username, strings.Join(a.Notes, "; ")))
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(res.Users) == 0 {
		res.Failures = append(res.Failures, "no users found in target for auth audit")
	}
	res.OK = len(res.Failures) == 0
	return res, nil
}

func auditHash(username, encoded string) UserAudit {
	a := UserAudit{Username: username, OK: true}
	parts := strings.Split(encoded, ":")
	a.Parts = len(parts)
	if len(parts) != 2 {
		a.OK = false
		a.Notes = append(a.Notes, fmt.Sprintf("want 2 colon-separated parts, got %d", len(parts)))
		return a
	}
	salt, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		a.OK = false
		a.Notes = append(a.Notes, "salt base64 decode failed: "+err.Error())
		return a
	}
	hash, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		a.OK = false
		a.Notes = append(a.Notes, "hash base64 decode failed: "+err.Error())
		return a
	}
	a.SaltBytes = len(salt)
	a.HashBytes = len(hash)
	if len(salt) != saltSize {
		a.OK = false
		a.Notes = append(a.Notes, fmt.Sprintf("salt len %d want %d", len(salt), saltSize))
	}
	if len(hash) != hashSize {
		a.OK = false
		a.Notes = append(a.Notes, fmt.Sprintf("hash len %d want %d", len(hash), hashSize))
	}
	if a.OK {
		a.Notes = append(a.Notes, "format base64(salt):base64(hash) OK; argon2id params t=3,m=65536,p=1 (mirrors backend/internal/auth)")
	}
	return a
}

// verifyPassword mirrors auth.VerifyPassword in backend/internal/auth/password.go.
func verifyPassword(password, encoded string) bool {
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
