// Package habits ports habit-service's habits + completions surface (see
// winzy.ai-rdc7.3.1): CRUD on habits and logging/correcting completions.
// Stats, promises, and the public flame surfaces are out of scope here —
// they land with the consistency engine (winzy.ai-rdc7.3.2) and Flame
// Promises (winzy.ai-rdc7.3.3).
package habits

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	// Blank-imported so IANA timezone lookups (time.LoadLocation) work from
	// the embedded tzdata database rather than depending on the runtime
	// having /usr/share/zoneinfo — the distroless production image (see
	// migrations/migrations.go's doc comment on why SQL is embedded for the
	// same reason) has no system zoneinfo files.
	_ "time/tzdata"
)

// Frequency mirrors Winzy.Contracts... actually FrequencyType, which lives
// in this service (Winzy.HabitService.Entities.FrequencyType): Daily,
// Weekly, Custom. The wire (JSON) and Go-internal representation is the
// lowercase name, matching frontend/src/api/habits.ts's FrequencyType
// string union exactly; the DB column stores the PascalCase C# enum name
// (see store.go) because that is what EF Core's HasConversion<string>()
// wrote for every existing/ported row shape this system must stay
// compatible with.
type Frequency string

const (
	FrequencyDaily  Frequency = "daily"
	FrequencyWeekly Frequency = "weekly"
	FrequencyCustom Frequency = "custom"
)

func (f Frequency) valid() bool {
	switch f {
	case FrequencyDaily, FrequencyWeekly, FrequencyCustom:
		return true
	}
	return false
}

// requiresCustomDays reports whether f needs a non-empty CustomDays list,
// matching HabitEndpoints.cs's "Weekly and Custom frequency" checks (Weekly
// habits store which weekdays count exactly like Custom ones do).
func (f Frequency) requiresCustomDays() bool {
	return f == FrequencyWeekly || f == FrequencyCustom
}

func (f Frequency) dbValue() string {
	switch f {
	case FrequencyWeekly:
		return "Weekly"
	case FrequencyCustom:
		return "Custom"
	default:
		return "Daily"
	}
}

func frequencyFromDB(s string) Frequency {
	switch s {
	case "Weekly":
		return FrequencyWeekly
	case "Custom":
		return FrequencyCustom
	default:
		return FrequencyDaily
	}
}

// UnmarshalJSON rejects any string that is not "daily", "weekly", or
// "custom" (case-insensitively), matching the deserialization-time failure
// .NET's JsonStringEnumConverter produces for an unrecognized enum name —
// TryReadBodyAsync surfaces that as a generic 400 "Invalid JSON in request
// body", which is exactly what an error returned from here becomes once
// handlers.go's shared decode helper propagates it. This is a stricter,
// fail-fast contrast to CompletionKind, whose invalid values are only
// caught by an explicit runtime check downstream — see CompletionKind's
// doc comment for why the two enums diverge here.
func (f *Frequency) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	parsed := Frequency(strings.ToLower(s))
	if !parsed.valid() {
		return fmt.Errorf("habits: invalid frequency %q", s)
	}
	*f = parsed
	return nil
}

// CompletionKind mirrors Winzy.Contracts.CompletionKind (None=0, Full=1,
// Minimum=2). The wire contract is deliberately asymmetric, matching the
// untouched frontend and the old JsonStringEnumConverter's behavior:
// requests carry the raw numeric enum value (frontend/src/api/habits.ts's
// CompleteHabitRequest.completionKind and updateCompletion's parameter are
// both typed `number`), responses render the lowercase name (habit-service's
// endpoint handlers build response DTOs with
// `completionKind.ToString().ToLowerInvariant()`).
type CompletionKind int

const (
	CompletionNone    CompletionKind = 0
	CompletionFull    CompletionKind = 1
	CompletionMinimum CompletionKind = 2
)

// String renders the lowercase wire/response form.
func (k CompletionKind) String() string {
	switch k {
	case CompletionFull:
		return "full"
	case CompletionMinimum:
		return "minimum"
	default:
		return "none"
	}
}

func (k CompletionKind) dbValue() string {
	switch k {
	case CompletionFull:
		return "Full"
	case CompletionMinimum:
		return "Minimum"
	default:
		return "None"
	}
}

func completionKindFromDB(s string) CompletionKind {
	switch s {
	case "Full":
		return CompletionFull
	case "Minimum":
		return CompletionMinimum
	default:
		return CompletionNone
	}
}

// validForLogging reports whether k is an acceptable value for a
// completion a caller is actually logging (Full or Minimum) — None is a
// well-formed CompletionKind value but not a valid one to log, matching
// CompletionEndpoints.cs's explicit `is not (Full or Minimum)` check. This
// runs after JSON decoding (unlike Frequency's rejection, which happens
// during decoding) because .NET's converter accepts any integer for an
// enum without validating membership — the None-is-invalid rule is the
// endpoint's own business logic, not a deserialization failure, in the
// source this ports.
func (k CompletionKind) validForLogging() bool {
	return k == CompletionFull || k == CompletionMinimum
}

// Habit mirrors the habits table. IDs are the Postgres uuid column's
// canonical text form (see internal/auth/store.go's doc comment for why
// this codebase carries ids as plain strings).
type Habit struct {
	ID                 string
	CreatedAt          time.Time
	UpdatedAt          time.Time
	UserID             string
	Name               string
	Icon               *string
	Color              *string
	Frequency          Frequency
	CustomDays         []int // nil unless Frequency requires it
	MinimumDescription *string
	ArchivedAt         *time.Time
}

// Completion mirrors the completions table. LocalDate is stored and
// compared as a UTC-midnight time.Time purely so date arithmetic (window
// bounds, "is this in the future") is easy; it never carries a real
// time-of-day or timezone — see completeHabitLocalDate's doc comment for how
// it is computed from the caller's IANA timezone at write time.
type Completion struct {
	ID             string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	HabitID        string
	UserID         string
	CompletedAt    time.Time
	LocalDate      time.Time
	CompletionKind CompletionKind
	Note           *string
}

// --- Request DTOs (JSON field names match HabitEndpoints.cs /
// CompletionEndpoints.cs's camelCase wire format exactly, verified against
// frontend/src/api/habits.ts). ---

type CreateHabitRequest struct {
	Name               string     `json:"name"`
	Icon               *string    `json:"icon"`
	Color              *string    `json:"color"`
	Frequency          *Frequency `json:"frequency"`
	CustomDays         []int      `json:"customDays"`
	MinimumDescription *string    `json:"minimumDescription"`
}

type UpdateHabitRequest struct {
	Name                    *string    `json:"name"`
	Icon                    *string    `json:"icon"`
	Color                   *string    `json:"color"`
	Frequency               *Frequency `json:"frequency"`
	CustomDays              []int      `json:"customDays"`
	MinimumDescription      *string    `json:"minimumDescription"`
	ClearMinimumDescription *bool      `json:"clearMinimumDescription"`
}

type CompleteHabitRequest struct {
	Date           *string         `json:"date"`
	Timezone       string          `json:"timezone"`
	CompletionKind *CompletionKind `json:"completionKind"`
}

type UpdateCompletionRequest struct {
	CompletionKind CompletionKind `json:"completionKind"`
}

// --- Response DTOs ---

type HabitResponse struct {
	ID                 string     `json:"id"`
	Name               string     `json:"name"`
	Icon               *string    `json:"icon"`
	Color              *string    `json:"color"`
	Frequency          string     `json:"frequency"`
	CustomDays         []int      `json:"customDays"`
	MinimumDescription *string    `json:"minimumDescription"`
	CreatedAt          time.Time  `json:"createdAt"`
	ArchivedAt         *time.Time `json:"archivedAt"`
}

func toHabitResponse(h Habit) HabitResponse {
	return HabitResponse{
		ID:                 h.ID,
		Name:               h.Name,
		Icon:               h.Icon,
		Color:              h.Color,
		Frequency:          string(h.Frequency),
		CustomDays:         h.CustomDays,
		MinimumDescription: h.MinimumDescription,
		CreatedAt:          h.CreatedAt,
		ArchivedAt:         h.ArchivedAt,
	}
}

// CompletionResponse is POST /habits/{id}/complete's response shape: the
// full HabitCompletion the frontend types. Consistency is 0 with a
// TODO(winzy.ai-rdc7.3.2) marker until the consistency engine lands — see
// service.go's CompleteHabit doc comment.
type CompletionResponse struct {
	ID             string    `json:"id"`
	HabitID        string    `json:"habitId"`
	LocalDate      string    `json:"localDate"`
	CompletedAt    time.Time `json:"completedAt"`
	CompletionKind string    `json:"completionKind"`
	Consistency    float64   `json:"consistency"`
}

// UpdateCompletionResponse is PUT /habits/{id}/completions/{date}'s response
// shape — deliberately without a "consistency" field, matching
// CompletionEndpoints.cs's UpdateCompletion exactly (it recomputes nothing
// and returns no consistency value, unlike CompleteHabit's response).
type UpdateCompletionResponse struct {
	ID             string    `json:"id"`
	HabitID        string    `json:"habitId"`
	LocalDate      string    `json:"localDate"`
	CompletedAt    time.Time `json:"completedAt"`
	CompletionKind string    `json:"completionKind"`
}

// CompletionsByDateResponse is GET /habits/completions?date=...'s response
// shape.
type CompletionsByDateResponse struct {
	Date   string                   `json:"date"`
	Habits []HabitCompletionForDate `json:"habits"`
}

type HabitCompletionForDate struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Icon               *string `json:"icon"`
	Color              *string `json:"color"`
	MinimumDescription *string `json:"minimumDescription"`
	Completed          bool    `json:"completed"`
	CompletionKind     *string `json:"completionKind"`
}

const isoDateLayout = "2006-01-02"

func formatISODate(t time.Time) string {
	return t.Format(isoDateLayout)
}

// parseISODate parses s as a strict YYYY-MM-DD calendar date, rejecting both
// malformed input and overflowed dates (e.g. "2025-02-30") that
// time.Parse alone would silently normalize instead of erroring on —
// matching .NET's DateOnly.TryParse, which rejects both. The returned time
// is UTC midnight and carries no real timezone.
func parseISODate(s string) (time.Time, bool) {
	t, err := time.Parse(isoDateLayout, s)
	if err != nil {
		return time.Time{}, false
	}
	if t.Format(isoDateLayout) != s {
		return time.Time{}, false
	}
	return t, true
}

// todayInLocation returns the current calendar date in loc, as a UTC
// midnight time.Time — the Go equivalent of
// DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz)).
func todayInLocation(loc *time.Location) time.Time {
	now := time.Now().In(loc)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
}

func trimToNil(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// trimPtr trims s in place without collapsing an explicit blank string to
// nil — matching HabitEndpoints.cs's Icon/Color handling, which trims but
// (unlike MinimumDescription) never converts blank to null.
func trimPtr(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	return &trimmed
}
