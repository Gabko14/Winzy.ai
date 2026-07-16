package httpserver

import (
	"context"
	"testing"
)

func TestUserID_HappyPath_SetIsVisibleThroughSharedState(t *testing.T) {
	t.Parallel()
	ctx, _ := withRequestState(context.Background())
	SetUserID(ctx, "user-1")

	if got := UserIDFromContext(ctx); got != "user-1" {
		t.Errorf("UserIDFromContext = %q, want user-1", got)
	}
}

func TestUserID_EdgeCase_MutationVisibleToOuterContextVariable(t *testing.T) {
	t.Parallel()
	// This is the property RequestLogging depends on: a context derived
	// from ctx (as r.WithContext would produce deeper in the chain) can
	// mutate the same state that ctx itself points to.
	ctx, _ := withRequestState(context.Background())
	derived := context.WithValue(ctx, struct{}{}, "unrelated")

	SetUserID(derived, "user-2")

	if got := UserIDFromContext(ctx); got != "user-2" {
		t.Errorf("UserIDFromContext(ctx) = %q, want user-2 (set via a derived context)", got)
	}
}

func TestUserID_ErrorCase_NoRequestStateIsNoOp(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	SetUserID(ctx, "user-3") // must not panic
	if got := UserIDFromContext(ctx); got != "" {
		t.Errorf("UserIDFromContext = %q, want empty string when no requestState is present", got)
	}
}
