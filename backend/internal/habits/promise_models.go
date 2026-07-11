package habits

import (
	"fmt"
	"strings"
	"time"
)

// PromiseStatus mirrors Winzy.HabitService.Entities.PromiseStatus
// (Active/Kept/EndedBelow/Cancelled). The DB column stores the C# PascalCase
// name verbatim, matching Frequency/CompletionKind's dbValue convention in
// models.go; the wire (JSON) form is the lowercase name via String(),
// matching PromiseEndpoints.cs's `Status.ToString().ToLowerInvariant()`.
type PromiseStatus string

const (
	PromiseActive     PromiseStatus = "Active"
	PromiseKept       PromiseStatus = "Kept"
	PromiseEndedBelow PromiseStatus = "EndedBelow"
	PromiseCancelled  PromiseStatus = "Cancelled"
)

// String renders the lowercase wire/response form ("endedbelow" for
// EndedBelow, matching C#'s ToLowerInvariant() — there is no separator).
func (s PromiseStatus) String() string {
	return strings.ToLower(string(s))
}

func promiseStatusFromDB(s string) PromiseStatus {
	switch PromiseStatus(s) {
	case PromiseKept:
		return PromiseKept
	case PromiseEndedBelow:
		return PromiseEndedBelow
	case PromiseCancelled:
		return PromiseCancelled
	default:
		return PromiseActive
	}
}

// Promise mirrors the promises table. EndDate is a UTC-midnight civil date,
// like Completion.LocalDate (see that field's doc comment in models.go).
type Promise struct {
	ID                string
	CreatedAt         time.Time
	UpdatedAt         time.Time
	UserID            string
	HabitID           string
	TargetConsistency float64
	EndDate           time.Time
	PrivateNote       *string
	Status            PromiseStatus
	IsPublicOnFlame   bool
	ResolvedAt        *time.Time
}

// --- Request DTOs (JSON field names match PromiseEndpoints.cs's camelCase
// wire format exactly). ---

type CreatePromiseRequest struct {
	TargetConsistency float64 `json:"targetConsistency"`
	EndDate           string  `json:"endDate"`
	PrivateNote       *string `json:"privateNote"`
	IsPublicOnFlame   *bool   `json:"isPublicOnFlame"`
}

type UpdatePromiseVisibilityRequest struct {
	IsPublicOnFlame bool `json:"isPublicOnFlame"`
}

// --- Response DTOs ---

// PromiseResponse is the owner-facing promise projection —
// MapPromiseToResponse in PromiseEndpoints.cs. Unlike PublicPromiseResponse,
// it includes PrivateNote and every internal field; never serialize this on
// a public or shared surface (see PublicPromiseResponse's doc comment).
type PromiseResponse struct {
	ID                 string     `json:"id"`
	HabitID            string     `json:"habitId"`
	TargetConsistency  float64    `json:"targetConsistency"`
	EndDate            string     `json:"endDate"`
	PrivateNote        *string    `json:"privateNote"`
	Status             string     `json:"status"`
	OnTrack            *bool      `json:"onTrack"`
	CurrentConsistency *float64   `json:"currentConsistency"`
	IsPublicOnFlame    bool       `json:"isPublicOnFlame"`
	Statement          string     `json:"statement"`
	CreatedAt          time.Time  `json:"createdAt"`
	ResolvedAt         *time.Time `json:"resolvedAt"`
}

// PublicPromiseResponse is the public-safe projection —
// MapPromiseToPublicResponse in PromiseEndpoints.cs — deliberately excluding
// PrivateNote and every internal field (id, isPublicOnFlame, createdAt,
// resolvedAt): only what a public flame page or witness link may ever show.
type PublicPromiseResponse struct {
	TargetConsistency float64 `json:"targetConsistency"`
	EndDate           string  `json:"endDate"`
	Statement         string  `json:"statement"`
	OnTrack           *bool   `json:"onTrack"`
}

// GetPromiseResponse is GET /habits/{id}/promise's response shape: the
// current active promise (nil if none) plus, when ?history=true, every
// resolved/cancelled promise for the habit newest-resolved-first. History is
// always a non-nil (possibly empty) slice so it serializes as `[]`, never
// `null`, matching GetPromise's `history: Array.Empty<object>()` default.
type GetPromiseResponse struct {
	Active  *PromiseResponse  `json:"active"`
	History []PromiseResponse `json:"history"`
}

// onTrackFor computes the shared OnTrack projection both response shapes
// use: non-nil only for a still-Active promise with a known current
// consistency, matching both MapPromiseToResponse and
// MapPromiseToPublicResponse's identical ternary in PromiseEndpoints.cs.
func onTrackFor(status PromiseStatus, target float64, current *float64) *bool {
	if status != PromiseActive || current == nil {
		return nil
	}
	onTrack := *current >= target
	return &onTrack
}

// toPromiseResponse builds the owner-facing projection. currentConsistency
// is nil for history entries, matching GetPromise's
// `MapPromiseToResponse(p, null)` for every non-active promise.
func toPromiseResponse(p Promise, currentConsistency *float64) PromiseResponse {
	return PromiseResponse{
		ID:                 p.ID,
		HabitID:            p.HabitID,
		TargetConsistency:  p.TargetConsistency,
		EndDate:            formatISODate(p.EndDate),
		PrivateNote:        p.PrivateNote,
		Status:             p.Status.String(),
		OnTrack:            onTrackFor(p.Status, p.TargetConsistency, currentConsistency),
		CurrentConsistency: currentConsistency,
		IsPublicOnFlame:    p.IsPublicOnFlame,
		Statement:          generatePromiseStatement(p),
		CreatedAt:          p.CreatedAt,
		ResolvedAt:         p.ResolvedAt,
	}
}

// toPublicPromiseResponse builds the public-safe projection — see
// PublicPromiseResponse's doc comment for what it deliberately omits.
func toPublicPromiseResponse(p Promise, currentConsistency *float64) PublicPromiseResponse {
	return PublicPromiseResponse{
		TargetConsistency: p.TargetConsistency,
		EndDate:           formatISODate(p.EndDate),
		Statement:         generatePromiseStatement(p),
		OnTrack:           onTrackFor(p.Status, p.TargetConsistency, currentConsistency),
	}
}

// generatePromiseStatement renders the promise's human-readable summary,
// matching GeneratePromiseStatement in PromiseEndpoints.cs: the target
// truncated (not rounded) to an int, and the end date as "MMMM d" (full
// month name, no leading zero on the day) — Go's "January 2" layout is the
// exact analogue.
func generatePromiseStatement(p Promise) string {
	return fmt.Sprintf("Keeping above %d%% through %s", int(p.TargetConsistency), p.EndDate.Format("January 2"))
}
