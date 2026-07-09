package events_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/events"
)

type widgetCreated struct {
	ID string
}

type gadgetCreated struct {
	ID string
}

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestEmit_HappyPath_InvokesRegisteredHandlerInOrder(t *testing.T) {
	r := events.New(silentLogger())
	var order []string

	events.Register(r, events.Handler[widgetCreated](func(_ context.Context, e widgetCreated) error {
		order = append(order, "first:"+e.ID)
		return nil
	}))
	events.Register(r, events.Handler[widgetCreated](func(_ context.Context, e widgetCreated) error {
		order = append(order, "second:"+e.ID)
		return nil
	}))

	if err := events.Emit(context.Background(), r, widgetCreated{ID: "w1"}); err != nil {
		t.Fatalf("Emit() returned unexpected error: %v", err)
	}

	want := []string{"first:w1", "second:w1"}
	if len(order) != len(want) || order[0] != want[0] || order[1] != want[1] {
		t.Errorf("handlers ran as %v, want %v", order, want)
	}
}

func TestEmit_EdgeCase_NoHandlersRegisteredIsANoOp(t *testing.T) {
	r := events.New(silentLogger())

	if err := events.Emit(context.Background(), r, widgetCreated{ID: "w1"}); err != nil {
		t.Fatalf("Emit() with no registered handlers should be a no-op, got error: %v", err)
	}
}

func TestEmit_EdgeCase_DifferentEventTypesDoNotCrossFire(t *testing.T) {
	r := events.New(silentLogger())
	var widgetCalls, gadgetCalls int

	events.Register(r, events.Handler[widgetCreated](func(_ context.Context, _ widgetCreated) error {
		widgetCalls++
		return nil
	}))
	events.Register(r, events.Handler[gadgetCreated](func(_ context.Context, _ gadgetCreated) error {
		gadgetCalls++
		return nil
	}))

	if err := events.Emit(context.Background(), r, widgetCreated{ID: "w1"}); err != nil {
		t.Fatalf("Emit(widgetCreated) returned unexpected error: %v", err)
	}

	if widgetCalls != 1 {
		t.Errorf("widgetCalls = %d, want 1", widgetCalls)
	}
	if gadgetCalls != 0 {
		t.Errorf("gadgetCalls = %d, want 0 (gadget handler must not fire for a widgetCreated event)", gadgetCalls)
	}
}

func TestEmit_ErrorCase_HandlerFailureStopsDispatchAndPropagates(t *testing.T) {
	r := events.New(silentLogger())
	var secondCalled bool
	wantErr := errors.New("boom")

	events.Register(r, events.Handler[widgetCreated](func(_ context.Context, _ widgetCreated) error {
		return wantErr
	}))
	events.Register(r, events.Handler[widgetCreated](func(_ context.Context, _ widgetCreated) error {
		secondCalled = true
		return nil
	}))

	err := events.Emit(context.Background(), r, widgetCreated{ID: "w1"})
	if err == nil {
		t.Fatal("Emit() should return an error when a handler fails")
	}
	if !errors.Is(err, wantErr) {
		t.Errorf("Emit() error = %v, want it to wrap %v", err, wantErr)
	}
	if secondCalled {
		t.Error("a handler registered after a failing handler must not run")
	}
}

func TestEmit_ErrorCase_MultipleHandlersSameTypeAllRunUntilFailure(t *testing.T) {
	r := events.New(silentLogger())
	var calls []int

	for i := range 3 {
		i := i
		events.Register(r, events.Handler[widgetCreated](func(_ context.Context, _ widgetCreated) error {
			calls = append(calls, i)
			if i == 1 {
				return errors.New("second handler fails")
			}
			return nil
		}))
	}

	if err := events.Emit(context.Background(), r, widgetCreated{ID: "w1"}); err == nil {
		t.Fatal("Emit() should return an error")
	}

	if len(calls) != 2 || calls[0] != 0 || calls[1] != 1 {
		t.Errorf("calls = %v, want [0 1] (dispatch stops right after the failing handler)", calls)
	}
}
