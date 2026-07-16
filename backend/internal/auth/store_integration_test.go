//go:build integration

package auth

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/Gabko14/winzy/backend/internal/dbtest"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/ratelimit"
)

// TestCreateUser_ErrorCase_UniqueViolationReturnsRaceMessage deterministically
// exercises createUser's isUniqueViolation branch — the DB-level race path a
// concurrent HTTP test can only hit non-deterministically (see
// TestRegister_ErrorCase_ConcurrentDuplicateRegistrationsResolveToExactlyOneWinner
// in register_integration_test.go) — by calling createUser directly twice
// with no pre-check SELECT in between, guaranteeing the second call hits the
// unique index rather than Service.Register's friendlier pre-check message.
func TestCreateUser_ErrorCase_UniqueViolationReturnsRaceMessage(t *testing.T) {
	t.Parallel()
	pool := dbtest.ConnectParallel(t)
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
	t.Parallel()
	pool := dbtest.ConnectParallel(t)
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

// TestServiceExport_HappyPath_AuthSectionBuiltFromGateFetchComesFirst pins
// the winzy.ai-ibxb fix in place. Auth's export section used to be a
// registered export.Section that re-fetched the same user row
// Service.Export's existence gate had just fetched and discarded — a
// wasted duplicate query, and a race: if DELETE /auth/account landed
// between the two fetches, the gate's 200 had already committed while the
// section's fetch came back not-found, an error the registry degraded to a
// warning instead of the whole export 404ing. Export now builds the "auth"
// section directly from the gate's single fetch (there is no second query
// left to race against a concurrent delete) and prepends it to the
// registry's sections. This test pins both load-bearing properties of that
// shape: the "auth" section leads the output (preserving the response
// order from when it was the registry's first registration), and its data
// comes from the gate-fetched user. The sequential delete-then-export 404
// is covered at the HTTP level by
// TestExport_ErrorCase_AfterAccountDeletedReturnsNotFound in
// export_integration_test.go.
func TestServiceExport_HappyPath_AuthSectionBuiltFromGateFetchComesFirst(t *testing.T) {
	t.Parallel()
	pool := dbtest.ConnectParallel(t)
	ctx := context.Background()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	exportReg := export.New(logger)
	exportReg.Register("habits", func(_ context.Context, _ string) (any, error) {
		return map[string]any{"habits": []any{}}, nil
	})
	svc := &Service{
		pool:          pool,
		exportReg:     exportReg,
		exportLimiter: ratelimit.New(1, time.Minute),
		logger:        logger,
	}

	user, err := createUser(ctx, pool, "export-gate@example.com", "exportgateuser", "irrelevant-hash", nil)
	if err != nil {
		t.Fatalf("createUser() returned unexpected error: %v", err)
	}

	services, warnings, err := svc.Export(ctx, user.ID)
	if err != nil {
		t.Fatalf("Export() returned unexpected error: %v", err)
	}
	if len(warnings) != 0 {
		t.Errorf("warnings = %v, want empty", warnings)
	}
	if len(services) != 2 {
		t.Fatalf("services = %+v, want 2 (auth prepended + habits)", services)
	}
	if services[0].Service != "auth" || services[1].Service != "habits" {
		t.Errorf("section order = [%s, %s], want [auth, habits]", services[0].Service, services[1].Service)
	}
	got, ok := services[0].Data.(authExportData)
	if !ok {
		t.Fatalf("auth section data is %T, want authExportData", services[0].Data)
	}
	if got.UserID != user.ID || got.Email != user.Email || got.Username != user.Username {
		t.Errorf("auth section = %+v, want data for user id=%s email=%s username=%s", got, user.ID, user.Email, user.Username)
	}
}
