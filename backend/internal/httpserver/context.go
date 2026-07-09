package httpserver

import (
	"context"
	"sync"
)

// requestState is a mutable box installed in the request context by
// RequestLogging. It exists because context.WithValue is immutable: a value
// an inner middleware (e.g. the JWT auth middleware landing in rdc7.2)
// installs via WithValue is invisible to an outer middleware that already
// captured the pre-call context, which is exactly RequestLogging's
// situation — it must log user_id, but only learns it (if at all) from a
// middleware nested inside it. Sharing one mutable struct through the
// context, instead of replacing the context, makes that mutation visible to
// RequestLogging after next.ServeHTTP returns.
type requestState struct {
	mu     sync.Mutex
	userID string
}

type requestStateKey struct{}

// withRequestState installs a fresh, empty requestState in ctx and returns
// both the new context and the state, so the caller (RequestLogging) can
// read fields back directly after the handler chain runs.
func withRequestState(ctx context.Context) (context.Context, *requestState) {
	state := &requestState{}
	return context.WithValue(ctx, requestStateKey{}, state), state
}

// SetUserID records the authenticated user's id on the current request so
// RequestLogging includes it in the request's log line. It is a no-op if
// called on a context that never passed through RequestLogging (which
// should not happen in production, since RequestLogging is always the
// outermost-but-one middleware — see httpserver.New).
func SetUserID(ctx context.Context, userID string) {
	if state, ok := ctx.Value(requestStateKey{}).(*requestState); ok {
		state.mu.Lock()
		state.userID = userID
		state.mu.Unlock()
	}
}

// UserIDFromContext returns the authenticated user's id, or "" if the
// request is unauthenticated or no requestState is present.
func UserIDFromContext(ctx context.Context) string {
	if state, ok := ctx.Value(requestStateKey{}).(*requestState); ok {
		state.mu.Lock()
		defer state.mu.Unlock()
		return state.userID
	}
	return ""
}
