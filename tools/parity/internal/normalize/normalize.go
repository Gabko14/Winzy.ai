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
	// Civil yyyy-MM-dd dates are scenario-relative ("today", "today-5") and
	// must not fail a Go-vs-golden check solely because the golden was
	// captured on a different calendar day. Masked by first-seen order
	// within one document, same as UUIDs (see MaskCivilDates).
	civilDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	// JWT: three base64url segments that are each long enough to be real
	// header/payload/sig material. Without a per-segment minimum,
	// dotted event types like "friend.request.accepted" were falsely
	// masked as {{token}} (phase-2 finding / PM deviation #4).
	jwtRe = regexp.MustCompile(`^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$`)
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

// MaskCivilDates walks an already-canonicalized value and replaces every
// yyyy-MM-dd string with a stable {{date:N}} placeholder assigned by
// first-seen order within this document (keys sorted, arrays by index).
// Apply to BOTH golden and actual before Diff so a golden captured on day
// D and a check run on day D+N compare equal when the relative dating is
// the same.
func MaskCivilDates(v any) any {
	s := &scope{seen: make(map[string]string)}
	return s.maskDates(v)
}

func (s *scope) maskDates(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			out[k] = s.maskDates(t[k])
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, e := range t {
			out[i] = s.maskDates(e)
		}
		return out
	case string:
		if civilDateRe.MatchString(t) {
			if ph, ok := s.seen[t]; ok {
				return ph
			}
			s.nextID++
			ph := fmt.Sprintf("{{date:%d}}", s.nextID)
			s.seen[t] = ph
			return ph
		}
		return t
	default:
		return v
	}
}

// StableSortFeedItems walks a canonicalized value and, for every object
// that has an "items" array of feed-entry-shaped objects, reorders that
// array by (createdAt, eventType, actorId, id). After timestamp masking
// createdAt is usually identical across items, so the secondary keys make
// tied-timestamp friend.accept pairs compare in a deterministic order on
// both golden and actual (phase-2 F6a — not an allowlist).
func StableSortFeedItems(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, child := range t {
			if k == "items" {
				if arr, ok := child.([]any); ok && feedItems(arr) {
					out[k] = sortFeedItems(arr)
					continue
				}
			}
			out[k] = StableSortFeedItems(child)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, e := range t {
			out[i] = StableSortFeedItems(e)
		}
		return out
	default:
		return v
	}
}

func feedItems(arr []any) bool {
	if len(arr) == 0 {
		return false
	}
	for _, e := range arr {
		m, ok := e.(map[string]any)
		if !ok {
			return false
		}
		if _, hasEvent := m["eventType"]; !hasEvent {
			if _, hasCreated := m["createdAt"]; !hasCreated {
				return false
			}
		}
	}
	return true
}

func sortFeedItems(arr []any) []any {
	out := make([]any, len(arr))
	copy(out, arr)
	sort.SliceStable(out, func(i, j int) bool {
		return feedSortKey(out[i]) < feedSortKey(out[j])
	})
	// Re-label item ids by post-sort position. UUID ordinals were assigned
	// during Canonicalize in discovery order; after a secondary sort those
	// labels no longer align across golden vs actual even when the items
	// themselves match (F6a residual on visibility feed).
	for i, e := range out {
		m, ok := e.(map[string]any)
		if !ok {
			continue
		}
		cp := make(map[string]any, len(m))
		for k, v := range m {
			cp[k] = v
		}
		cp["id"] = fmt.Sprintf("{{feed-item:%d}}", i+1)
		out[i] = cp
	}
	return out
}

func feedSortKey(v any) string {
	m, ok := v.(map[string]any)
	if !ok {
		return ""
	}
	// Deliberately omit id — UUID ordinals are discovery-order artifacts and
	// must not influence the tie-break (they are re-labeled after sort).
	return fmt.Sprintf("%s\x00%s\x00%s",
		stringify(m["createdAt"]),
		stringify(m["eventType"]),
		stringify(m["actorId"]),
	)
}

func stringify(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return fmt.Sprint(t)
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
