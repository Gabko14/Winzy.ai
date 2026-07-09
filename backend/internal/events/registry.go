// Package events is the in-process, typed publish/subscribe hub that
// replaces NATS JetStream in the Go rewrite (see epic winzy.ai-rdc7: "What
// JetStream durability bought us... is now bought by running cascades in
// the same transaction or process"). Modules register handlers for the
// event types they care about at startup; other modules emit events at
// request time and every registered handler for that type runs
// synchronously, in the calling goroutine, before Emit returns.
//
// TRANSACTIONAL STANCE: dispatch is synchronous and in-process, so an event
// source and its handlers can share one Postgres transaction simply by
// passing a context bound to that transaction through to Emit (every module
// shares the single Winzy database, so this is always possible in this
// codebase, unlike the old per-service-database NATS world). A handler
// returning an error aborts dispatch to any handlers registered after it,
// and the error propagates to Emit's caller — which is expected to roll
// back its own transaction, giving atomic all-or-nothing delivery. This is
// strictly stronger than JetStream's at-least-once redelivery (no
// duplicate processing on retry) at the cost of no durability across a
// process crash mid-dispatch: an accepted tradeoff for the single-instance
// deploy this rewrite targets.
package events

import (
	"context"
	"fmt"
	"log/slog"
	"reflect"
	"sync"
)

// Handler processes an event of type T.
type Handler[T any] func(ctx context.Context, event T) error

// Registry is a typed, synchronous, in-process event hub. It is safe for
// concurrent use: Register is expected to run during module startup and
// Emit at request time, but both take the same mutex so no particular
// ordering is required.
type Registry struct {
	mu       sync.RWMutex
	handlers map[reflect.Type][]any
	logger   *slog.Logger
}

// New returns an empty Registry. logger receives one debug line per Emit
// call (event type, handler count) and one error line per handler failure,
// per the logging convention in the PM REVIEW ADDENDUM on winzy.ai-rdc7.1.
func New(logger *slog.Logger) *Registry {
	return &Registry{
		handlers: make(map[reflect.Type][]any),
		logger:   logger,
	}
}

// Register adds handler to the set invoked whenever Emit is called with an
// event of type T. Multiple handlers may register for the same T; they run
// in registration order.
func Register[T any](r *Registry, handler Handler[T]) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := reflect.TypeFor[T]()
	r.handlers[t] = append(r.handlers[t], handler)
}

// Emit synchronously invokes every handler registered for T, in the calling
// goroutine and in registration order, stopping at (and returning) the
// first handler error. It is a no-op (nil error) if no handler is
// registered for T, which is expected until later module beads land and
// register their own handlers for events auth already emits.
func Emit[T any](ctx context.Context, r *Registry, event T) error {
	r.mu.RLock()
	t := reflect.TypeFor[T]()
	handlers := append([]any(nil), r.handlers[t]...)
	r.mu.RUnlock()

	r.logger.DebugContext(ctx, "event emitted",
		"event_type", t.Name(),
		"handler_count", len(handlers),
		"payload", event,
	)

	for _, h := range handlers {
		handler := h.(Handler[T])
		if err := handler(ctx, event); err != nil {
			r.logger.ErrorContext(ctx, "event handler failed",
				"event_type", t.Name(),
				"payload", event,
				"error", err,
			)
			return fmt.Errorf("events: handler for %s failed: %w", t.Name(), err)
		}
	}
	return nil
}
