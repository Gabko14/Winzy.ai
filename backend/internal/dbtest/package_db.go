package dbtest

import (
	"fmt"
	"hash/fnv"
	"net/url"
	"path/filepath"
	"strings"
	"unicode"
)

const (
	testDBPrefix     = "winzy_test_"
	postgresIdentMax = 63
	pathHashHexLen   = 8 // 32-bit FNV hex suffix
)

// packageTestDBName builds winzy_test_<sanitized_basename>_<fnv32hex> from
// the package working directory (go test CWD = package source dir). The hash
// covers the full path so basename collisions (e.g. cmd/api vs internal/api)
// still get distinct databases. Result length is always ≤ 63 (Postgres
// identifier limit).
func packageTestDBName(wd string) string {
	clean := filepath.Clean(wd)
	base := filepath.Base(clean)
	sanitized := sanitizeIdent(base)
	if sanitized == "" {
		sanitized = "pkg"
	}
	sum := fnv.New32a()
	_, _ = sum.Write([]byte(clean))
	hash := fmt.Sprintf("%0*x", pathHashHexLen, sum.Sum32())

	// winzy_test_ + sanitized + _ + hash ≤ 63
	maxSanitized := postgresIdentMax - len(testDBPrefix) - 1 - pathHashHexLen
	if maxSanitized < 1 {
		maxSanitized = 1
	}
	if len(sanitized) > maxSanitized {
		sanitized = sanitized[:maxSanitized]
	}
	return testDBPrefix + sanitized + "_" + hash
}

func sanitizeIdent(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		case r == '_' || r == '-':
			b.WriteByte('_')
		}
	}
	return b.String()
}

// rewriteDatabaseURL returns databaseURL with the database name replaced by
// dbName. Supports postgres:// URLs (the project's TEST_DATABASE_URL form).
func rewriteDatabaseURL(databaseURL, dbName string) (string, error) {
	u, err := url.Parse(databaseURL)
	if err != nil {
		return "", fmt.Errorf("dbtest: parse database URL: %w", err)
	}
	if u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("dbtest: database URL must be a postgres:// URL (got %q)", databaseURL)
	}
	u.Path = "/" + dbName
	// url.Parse may leave Opaque set for some forms; clear it so Path wins.
	u.Opaque = ""
	return u.String(), nil
}

func maintenanceDatabaseURL(databaseURL string) (string, error) {
	return rewriteDatabaseURL(databaseURL, "postgres")
}

func createAdvisoryLockKey(dbName string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(dbName))
	return int64(h.Sum64())
}
