package reqid

import (
	"context"
	"regexp"
	"testing"
)

var uuidV4Pattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestNew_HappyPath_ReturnsWellFormedUUIDv4(t *testing.T) {
	id := New()
	if !uuidV4Pattern.MatchString(id) {
		t.Fatalf("New() = %q, does not match UUIDv4 pattern", id)
	}
}

func TestNew_EdgeCase_ConsecutiveCallsAreUnique(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		id := New()
		if seen[id] {
			t.Fatalf("New() produced duplicate id %q after %d calls", id, i)
		}
		seen[id] = true
	}
}

func TestContext_ErrorCase_MissingIDReturnsEmptyString(t *testing.T) {
	if got := FromContext(context.Background()); got != "" {
		t.Fatalf("FromContext(context.Background()) = %q, want empty string", got)
	}
}

func TestContext_HappyPath_RoundTrips(t *testing.T) {
	id := New()
	ctx := WithContext(context.Background(), id)
	if got := FromContext(ctx); got != id {
		t.Fatalf("FromContext(WithContext(ctx, %q)) = %q", id, got)
	}
}
