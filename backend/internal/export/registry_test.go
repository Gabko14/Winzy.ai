package export_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/export"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestExport_HappyPath_AssemblesAllSectionsInRegistrationOrder(t *testing.T) {
	r := export.New(silentLogger())
	r.Register("auth", func(_ context.Context, userID string) (any, error) {
		return map[string]string{"userId": userID}, nil
	})
	r.Register("habits", func(_ context.Context, userID string) (any, error) {
		return map[string]string{"userId": userID}, nil
	})

	services, warnings := r.Export(context.Background(), "user-1")

	if len(services) != 2 {
		t.Fatalf("len(services) = %d, want 2", len(services))
	}
	if services[0].Service != "auth" || services[1].Service != "habits" {
		t.Errorf("services = %+v, want auth then habits (registration order)", services)
	}
	if len(warnings) != 0 {
		t.Errorf("warnings = %v, want empty", warnings)
	}
}

func TestExport_EdgeCase_NoSectionsRegisteredReturnsEmptyNotNilSlices(t *testing.T) {
	r := export.New(silentLogger())

	services, warnings := r.Export(context.Background(), "user-1")

	if services == nil {
		t.Error("services should be an empty slice, not nil, so it serializes as [] not null")
	}
	if warnings == nil {
		t.Error("warnings should be an empty slice, not nil, so it serializes as [] not null")
	}
	if len(services) != 0 || len(warnings) != 0 {
		t.Errorf("services=%v warnings=%v, want both empty", services, warnings)
	}
}

func TestExport_EdgeCase_ReRegisteringSameNameKeepsOriginalPosition(t *testing.T) {
	r := export.New(silentLogger())
	r.Register("auth", func(_ context.Context, _ string) (any, error) { return "v1", nil })
	r.Register("habits", func(_ context.Context, _ string) (any, error) { return "habits-data", nil })
	r.Register("auth", func(_ context.Context, _ string) (any, error) { return "v2", nil })

	services, _ := r.Export(context.Background(), "user-1")

	if len(services) != 2 {
		t.Fatalf("len(services) = %d, want 2", len(services))
	}
	if services[0].Service != "auth" || services[0].Data != "v2" {
		t.Errorf("services[0] = %+v, want auth with updated data v2 still in first position", services[0])
	}
}

func TestExport_ErrorCase_FailingSectionBecomesAWarningNotAFailure(t *testing.T) {
	r := export.New(silentLogger())
	r.Register("auth", func(_ context.Context, userID string) (any, error) {
		return map[string]string{"userId": userID}, nil
	})
	r.Register("habits", func(_ context.Context, _ string) (any, error) {
		return nil, errors.New("habits db unreachable")
	})

	services, warnings := r.Export(context.Background(), "user-1")

	if len(services) != 1 || services[0].Service != "auth" {
		t.Errorf("services = %+v, want only the successful auth section", services)
	}
	if len(warnings) != 1 {
		t.Fatalf("len(warnings) = %d, want 1", len(warnings))
	}
	if warnings[0] != "Failed to export data from habits" {
		t.Errorf("warnings[0] = %q, want it to name the failing section", warnings[0])
	}
}
