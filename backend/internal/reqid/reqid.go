// Package reqid generates per-request identifiers and carries them on a
// context.Context so every log line in a request's lifecycle can be
// correlated.
package reqid

import (
	"context"
	"crypto/rand"
	"fmt"
)

type contextKey struct{}

var requestIDKey = contextKey{}

// New returns a random RFC 4122 version 4 UUID string. It is used instead of
// a UUID library so the scaffold has zero non-stdlib dependencies for
// something this small.
func New() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand.Read only fails if the OS entropy source is
		// unavailable, which is unrecoverable; a request ID is not worth a
		// panic, so fall back to an all-zero id rather than crash the server.
		return "00000000-0000-4000-8000-000000000000"
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10

	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// WithContext returns a copy of ctx carrying the given request ID.
func WithContext(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// FromContext returns the request ID stored in ctx, or "" if none is set.
func FromContext(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}
