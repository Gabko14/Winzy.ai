// Package normalize implements the response normalization + diff engine
// described in winzy.ai-rdc7.12: it canonicalizes documented volatile
// fields (generated UUIDs, timestamps, opaque tokens) so that two captures
// of a nondeterministic-by-nature API can be compared for structural/value
// equality, and produces a field-level diff report when they don't match.
//
// Volatile field categories are identified by VALUE SHAPE, not by field
// name, so the same logic applies uniformly across every endpoint without
// a per-endpoint allowlist:
//
//   - UUIDs (8-4-4-4-12 hex, case-insensitive): replaced with the
//     registered symbolic name from the id-mapping table (see internal/idmap)
//     when known, otherwise an ordinal placeholder "{{uuid:N}}" assigned by
//     first-seen order within the current response (deterministic: object
//     keys are visited in sorted order, arrays in index order, so two
//     structurally-identical responses assign identical ordinals even
//     though Go's native map iteration order is randomized).
//   - RFC3339 timestamps: replaced with "{{timestamp}}" — exact wall-clock
//     values are never meaningful to compare between two independent runs.
//   - Opaque tokens: JWTs (three dot-separated base64url segments) and
//     long base64url strings (refresh tokens, witness link tokens):
//     replaced with "{{token}}".
package normalize

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"winzy.ai/parity/internal/idmap"
)

var (
	uuidRe      = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	timestampRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`)
	jwtRe       = regexp.MustCompile(`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)
	// Refresh tokens are 64 random bytes base64-encoded (no padding chars
	// stripped in practice); witness tokens are base64url(32 bytes). Both
	// land comfortably over 40 chars of base64/base64url alphabet with no
	// separators, which a plain word like a habit name will not.
	opaqueTokenRe = regexp.MustCompile(`^[A-Za-z0-9_\-+/]{40,}={0,2}$`)
)

const (
	placeholderTimestamp = "{{timestamp}}"
	placeholderToken     = "{{token}}"
)

// scope carries the ordinal-assignment state for a single canonicalization
// pass (i.e. one response body). It must NOT be shared across responses:
// ordinals are only guaranteed stable within one document.
type scope struct {
	ids    *idmap.Map
	seen   map[string]string // raw uuid -> placeholder, first-seen within this document
	nextID int
}

// Canonicalize decodes raw JSON bytes and returns a canonicalized value
// suitable for stable comparison and storage. If ids is nil, no symbolic
// substitution is attempted (only ordinal placeholders + timestamp/token
// masking apply).
func Canonicalize(raw []byte, ids *idmap.Map) (any, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("normalize: body is not JSON: %w", err)
	}
	s := &scope{ids: ids, seen: make(map[string]string)}
	return s.walk(v), nil
}

func (s *scope) walk(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			out[k] = s.walk(t[k])
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, e := range t {
			out[i] = s.walk(e)
		}
		return out
	case string:
		return s.walkString(t)
	default:
		return v
	}
}

func (s *scope) walkString(str string) string {
	// Known seed values (checked first, any shape): registered during
	// seeding for every symbolic entity the scenario itself created —
	// covers not just UUIDs but the random email/username/etc. strings a
	// scenario generates fresh each run, so two independent runs with
	// different literal seed data still canonicalize identically.
	if s.ids != nil {
		if name, ok := s.ids.Lookup(str); ok {
			return "{{seed:" + name + "}}"
		}
		if name, ok := s.ids.Lookup(strings.ToLower(str)); ok {
			return "{{seed:" + name + "}}"
		}
	}

	switch {
	case uuidRe.MatchString(str):
		lower := strings.ToLower(str)
		if ph, ok := s.seen[lower]; ok {
			return ph
		}
		s.nextID++
		ph := fmt.Sprintf("{{uuid:%d}}", s.nextID)
		s.seen[lower] = ph
		return ph
	case timestampRe.MatchString(str):
		return placeholderTimestamp
	case jwtRe.MatchString(str):
		return placeholderToken
	case opaqueTokenRe.MatchString(str):
		return placeholderToken
	default:
		return str
	}
}

// Diff compares two canonicalized values and returns a list of
// human-readable field-level differences. An empty slice means the
// documents are equivalent after normalization.
func Diff(path string, a, b any) []string {
	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok {
			return []string{fmt.Sprintf("%s: type mismatch: object vs %T", path, b)}
		}
		var diffs []string
		keys := unionKeys(av, bv)
		for _, k := range keys {
			p := path + "." + k
			av2, aok := av[k]
			bv2, bok := bv[k]
			switch {
			case aok && !bok:
				diffs = append(diffs, fmt.Sprintf("%s: present in A only (value=%v)", p, av2))
			case !aok && bok:
				diffs = append(diffs, fmt.Sprintf("%s: present in B only (value=%v)", p, bv2))
			default:
				diffs = append(diffs, Diff(p, av2, bv2)...)
			}
		}
		return diffs
	case []any:
		bv, ok := b.([]any)
		if !ok {
			return []string{fmt.Sprintf("%s: type mismatch: array vs %T", path, b)}
		}
		if len(av) != len(bv) {
			return []string{fmt.Sprintf("%s: array length mismatch: %d vs %d", path, len(av), len(bv))}
		}
		var diffs []string
		for i := range av {
			diffs = append(diffs, Diff(fmt.Sprintf("%s[%d]", path, i), av[i], bv[i])...)
		}
		return diffs
	default:
		if !jsonEqual(a, b) {
			return []string{fmt.Sprintf("%s: %v != %v", path, a, b)}
		}
		return nil
	}
}

func unionKeys(a, b map[string]any) []string {
	set := make(map[string]struct{}, len(a)+len(b))
	for k := range a {
		set[k] = struct{}{}
	}
	for k := range b {
		set[k] = struct{}{}
	}
	keys := make([]string, 0, len(set))
	for k := range set {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func jsonEqual(a, b any) bool {
	ab, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return string(ab) == string(bb)
}
