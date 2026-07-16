package habits

import (
	"context"
	"time"

	"github.com/Gabko14/winzy/backend/internal/export"
)

// habitExport is one habit in this module's export.Section payload,
// matching InternalExport's per-habit projection in InternalEndpoints.cs
// field-for-field, plus a "promises" array (see exportSection's doc
// comment for why that's an addition over the C# source rather than a
// straight port).
type habitExport struct {
	HabitID     string             `json:"habitId"`
	Name        string             `json:"name"`
	Icon        *string            `json:"icon"`
	Color       *string            `json:"color"`
	Frequency   string             `json:"frequency"`
	CustomDays  []int              `json:"customDays"`
	ArchivedAt  *time.Time         `json:"archivedAt"`
	CreatedAt   time.Time          `json:"createdAt"`
	Completions []completionExport `json:"completions"`
	Promises    []promiseExport    `json:"promises"`
}

// completionExport mirrors InternalExport's per-completion projection
// exactly (completionId, completedAt, localDate, completionKind, note).
type completionExport struct {
	CompletionID   string    `json:"completionId"`
	CompletedAt    time.Time `json:"completedAt"`
	LocalDate      string    `json:"localDate"`
	CompletionKind string    `json:"completionKind"`
	Note           *string   `json:"note"`
}

// promiseExport is the owner's own export projection — deliberately
// PrivateNote-inclusive (unlike PublicPromiseResponse in promise_models.go),
// since this is the user exporting their own data, not a public/share
// surface.
type promiseExport struct {
	PromiseID         string     `json:"promiseId"`
	TargetConsistency float64    `json:"targetConsistency"`
	EndDate           string     `json:"endDate"`
	PrivateNote       *string    `json:"privateNote"`
	Status            string     `json:"status"`
	IsPublicOnFlame   bool       `json:"isPublicOnFlame"`
	CreatedAt         time.Time  `json:"createdAt"`
	ResolvedAt        *time.Time `json:"resolvedAt"`
}

// exportSection builds this user's full habits-module export: every habit
// they've ever created (including archived ones — InternalExport's query
// has no ArchivedAt filter), each with its completions and promises.
// Registered under the name "habit" in NewService, the in-process
// replacement for the old GET /habits/internal/export/{userId} endpoint
// (InternalExport in InternalEndpoints.cs), whose {habits: [...]} shape this
// matches field-for-field — plus a "promises" array per habit, a genuine
// gap-fill over the C# source (PM REVIEW ADDENDUM on winzy.ai-rdc7.3.3):
// InternalExport predates the Promise table and never exported promise data
// at all, so a user's data export was silently missing their own promises.
//
// Returns export.ErrNoData for a user with zero habits — NOT a warning.
// InternalExport itself 404s in that case (`if (habits.Count == 0) return
// Results.NotFound()`), and the OLD orchestrator (AuthEndpoints.cs's
// ExportData) treated that specific downstream 404 as `Failed: false`: the
// section is silently absent from the aggregated export, not reported as a
// failure. A genuine DB error below is a real failure and still becomes a
// warning via export.Registry's normal error handling.
func (s *Service) exportSection(ctx context.Context, userID string) (any, error) {
	habitsList, err := listAllHabitsForUser(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	if len(habitsList) == 0 {
		return nil, export.ErrNoData
	}

	out := make([]habitExport, len(habitsList))
	for i, hb := range habitsList {
		completions, err := completionsForExport(ctx, s.pool, hb.ID)
		if err != nil {
			return nil, err
		}
		promises, err := promisesForExport(ctx, s.pool, hb.ID)
		if err != nil {
			return nil, err
		}

		completionsOut := make([]completionExport, len(completions))
		for j, c := range completions {
			completionsOut[j] = completionExport{
				CompletionID:   c.ID,
				CompletedAt:    c.CompletedAt,
				LocalDate:      formatISODate(c.LocalDate),
				CompletionKind: c.CompletionKind.String(),
				Note:           c.Note,
			}
		}

		promisesOut := make([]promiseExport, len(promises))
		for j, p := range promises {
			promisesOut[j] = promiseExport{
				PromiseID:         p.ID,
				TargetConsistency: p.TargetConsistency,
				EndDate:           formatISODate(p.EndDate),
				PrivateNote:       p.PrivateNote,
				Status:            p.Status.String(),
				IsPublicOnFlame:   p.IsPublicOnFlame,
				CreatedAt:         p.CreatedAt,
				ResolvedAt:        p.ResolvedAt,
			}
		}

		out[i] = habitExport{
			HabitID:     hb.ID,
			Name:        hb.Name,
			Icon:        hb.Icon,
			Color:       hb.Color,
			Frequency:   string(hb.Frequency),
			CustomDays:  hb.CustomDays,
			ArchivedAt:  hb.ArchivedAt,
			CreatedAt:   hb.CreatedAt,
			Completions: completionsOut,
			Promises:    promisesOut,
		}
	}

	return map[string]any{"habits": out}, nil
}
