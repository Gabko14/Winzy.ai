// Package idmap builds the symbolic id-mapping table used by the
// normalization engine. During seeding, scenarios register the mapping
// from a human-readable symbolic name (e.g. "user:alice") to every raw
// value the stack-under-test generated for that entity — its UUID, but
// also any randomly-generated seed values the scenario itself chose (e.g.
// "parity-auth-7f3a@winzy.test", chosen fresh every run so registration
// never collides with a previous run's leftover data). When normalizing a
// response, any value matching a registered raw value is replaced by its
// symbolic label, so two independent runs — each seeding its own random
// throwaway users — produce byte-identical canonicalized output as long as
// they perform the same sequence of calls in the same order. This is what
// makes the determinism check (capture twice, diff should be empty) work
// without requiring literal-value stability across runs, and later lets
// the same scenario code diff the old stack against the Go stack even
// though the two stacks assign unrelated random UUIDs to "the same"
// seeded entity.
package idmap

import "sync"

// Map is safe for concurrent use, though scenarios currently run serially.
type Map struct {
	mu      sync.RWMutex
	byValue map[string]string
}

func New() *Map {
	return &Map{byValue: make(map[string]string)}
}

// Register records that the given symbolic name refers to the given raw
// value as produced or chosen by the current run. Re-registering the same
// symbolic name with a different value overwrites the previous mapping for
// that value (useful for rotate/replace operations that issue a fresh
// value for the same symbolic entity, e.g. witness link token rotation) —
// the old raw value's mapping is intentionally left in place so earlier
// captured steps that still reference it keep normalizing correctly.
func (m *Map) Register(symbolicName, value string) {
	if value == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.byValue[value] = symbolicName
}

// Lookup returns the symbolic name for a raw value, if one was registered.
func (m *Map) Lookup(value string) (string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	name, ok := m.byValue[value]
	return name, ok
}
