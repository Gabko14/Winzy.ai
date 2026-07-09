//go:build integration

package auth

import (
	"context"
	"errors"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/dbtest"
)

// TestCreateUser_ErrorCase_UniqueViolationReturnsRaceMessage deterministically
// exercises createUser's isUniqueViolation branch — the DB-level race path a
// concurrent HTTP test can only hit non-deterministically (see
// TestRegister_ErrorCase_ConcurrentDuplicateRegistrationsResolveToExactlyOneWinner
// in register_integration_test.go) — by calling createUser directly twice
// with no pre-check SELECT in between, guaranteeing the second call hits the
// unique index rather than Service.Register's friendlier pre-check message.
func TestCreateUser_ErrorCase_UniqueViolationReturnsRaceMessage(t *testing.T) {
	pool := dbtest.Connect(t)
	ctx := context.Background()

	if _, err := createUser(ctx, pool, "race@example.com", "raceuser1", "irrelevant-hash", nil); err != nil {
		t.Fatalf("first createUser() returned unexpected error: %v", err)
	}

	_, err := createUser(ctx, pool, "race@example.com", "raceuser2", "irrelevant-hash", nil)
	if err == nil {
		t.Fatal("second createUser() with a duplicate email should return an error")
	}
	if !errors.Is(err, ErrConflict) {
		t.Errorf("error = %v, want it to wrap ErrConflict", err)
	}
	// Verbatim AuthEndpoints.cs's DbUpdateException catch: Results.Conflict(new
	// { error = "Email or username already taken." }).
	const want = "auth: conflict: Email or username already taken."
	if err.Error() != want {
		t.Errorf("error = %q, want %q", err.Error(), want)
	}
}

func TestCreateUser_ErrorCase_UniqueViolationOnUsernameAlsoReturnsRaceMessage(t *testing.T) {
	pool := dbtest.Connect(t)
	ctx := context.Background()

	if _, err := createUser(ctx, pool, "raceuser-a@example.com", "raceusername", "irrelevant-hash", nil); err != nil {
		t.Fatalf("first createUser() returned unexpected error: %v", err)
	}

	_, err := createUser(ctx, pool, "raceuser-b@example.com", "raceusername", "irrelevant-hash", nil)
	if err == nil {
		t.Fatal("second createUser() with a duplicate username should return an error")
	}
	const want = "auth: conflict: Email or username already taken."
	if err.Error() != want {
		t.Errorf("error = %q, want %q", err.Error(), want)
	}
}
