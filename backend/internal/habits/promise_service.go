package habits

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// ErrPromiseConflict is returned when creating a promise for a habit that
// already has an Active one — the (user_id, habit_id) partial unique index
// backing the 409 CreatePromise returns.
var ErrPromiseConflict = errors.New("habits: active promise already exists")

const (
	minTargetConsistency = 1.0
	maxTargetConsistency = 100.0
	maxPrivateNoteLength = 512
)

// resolveTimezoneLenient parses tz as an IANA timezone identifier, falling
// back to UTC for a blank or unrecognized value rather than erroring —
// matching every promise endpoint's own X-Timezone handling in
// PromiseEndpoints.cs (a TimeZoneNotFoundException is caught and silently
// ignored), which is deliberately more forgiving than resolveTimezone's
// strict 400 the stats/completion endpoints apply (see resolveTimezone's
// doc comment in service.go) — promises never reject a request over a bad
// timezone header, they just fall back.
func resolveTimezoneLenient(tz string) *time.Location {
	if strings.TrimSpace(tz) == "" {
		return time.UTC
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.UTC
	}
	return loc
}

// CreatePromise validates req and inserts a new Active promise for habitID,
// matching CreatePromise in PromiseEndpoints.cs.
func (s *Service) CreatePromise(ctx context.Context, userID, habitID string, req CreatePromiseRequest, timezone string) (Promise, error) {
	if !isValidUUID(habitID) {
		return Promise{}, ErrNotFound
	}
	if _, found, err := findActiveHabit(ctx, s.pool, userID, habitID); err != nil {
		return Promise{}, err
	} else if !found {
		return Promise{}, ErrNotFound
	}

	if req.TargetConsistency < minTargetConsistency || req.TargetConsistency > maxTargetConsistency {
		return Promise{}, newFieldError("Target consistency must be between 1 and 100")
	}

	endDate, ok := parseISODate(req.EndDate)
	if !ok {
		return Promise{}, newFieldError(fmt.Sprintf("Invalid end date format: %s", req.EndDate))
	}

	loc := resolveTimezoneLenient(timezone)
	today := civilDateInLocation(s.now(), loc)
	if !endDate.After(today) {
		return Promise{}, newFieldError("End date must be in the future")
	}

	privateNote := trimToNil(req.PrivateNote)
	if privateNote != nil && utf8.RuneCountInString(*privateNote) > maxPrivateNoteLength {
		return Promise{}, newFieldError("Private note must not exceed 512 characters")
	}

	isPublic := false
	if req.IsPublicOnFlame != nil {
		isPublic = *req.IsPublicOnFlame
	}

	// Pre-check for a clearer error path; insertPromise's unique-violation
	// handling is what actually enforces this against a race.
	if _, found, err := findActivePromise(ctx, s.pool, userID, habitID); err != nil {
		return Promise{}, err
	} else if found {
		return Promise{}, ErrPromiseConflict
	}

	return insertPromise(ctx, s.pool, Promise{
		UserID:            userID,
		HabitID:           habitID,
		TargetConsistency: req.TargetConsistency,
		EndDate:           endDate,
		PrivateNote:       privateNote,
		Status:            PromiseActive,
		IsPublicOnFlame:   isPublic,
	})
}

// GetPromise returns habitID's active promise (auto-resolving it first, to
// Kept or EndedBelow, if its EndDate has passed) and, when includeHistory is
// true, every previously resolved/cancelled promise — matching GetPromise in
// PromiseEndpoints.cs, lazy resolution included. Both the resolution check
// and the current-consistency calculation read "today" via Service.now in
// the owner's timezone (X-Timezone header, defaulting/falling back to UTC),
// never the real wall clock directly, so lazy resolution is exercisable by
// tests with a fake clock (winzy.ai-rdc7.3.3's SCOPE ADDITION).
func (s *Service) GetPromise(ctx context.Context, userID, habitID, timezone string, includeHistory bool) (GetPromiseResponse, error) {
	if !isValidUUID(habitID) {
		return GetPromiseResponse{}, ErrNotFound
	}
	habit, found, err := findActiveHabit(ctx, s.pool, userID, habitID)
	if err != nil {
		return GetPromiseResponse{}, err
	}
	if !found {
		return GetPromiseResponse{}, ErrNotFound
	}

	loc := resolveTimezoneLenient(timezone)
	now := s.now()

	active, activeFound, err := findActivePromise(ctx, s.pool, userID, habitID)
	if err != nil {
		return GetPromiseResponse{}, err
	}

	if activeFound {
		today := civilDateInLocation(now, loc)
		if active.EndDate.Before(today) {
			// Promise period has ended — resolve it against the habit's
			// current (owner-timezone) consistency, matching GetPromise's
			// lazy-resolution branch in PromiseEndpoints.cs. Promise
			// evaluation uses the same 60-day rolling-window consistency the
			// flame itself uses, not a promise-period-specific calculation.
			consistency, err := s.currentConsistency(ctx, habit, loc)
			if err != nil {
				return GetPromiseResponse{}, err
			}
			status := PromiseEndedBelow
			if consistency >= active.TargetConsistency {
				status = PromiseKept
			}
			// A lost race here (resolved=false — a concurrent cancel, archive,
			// or another GetPromise call already transitioned this promise
			// out of Active) is not an error: from this call's perspective the
			// promise is no longer Active either way, so it proceeds exactly
			// as if it had resolved it itself (see resolvePromise's doc
			// comment in promise_store.go).
			if _, _, err := resolvePromise(ctx, s.pool, active.ID, status, now.UTC()); err != nil {
				return GetPromiseResponse{}, err
			}
			activeFound = false
		}
	}

	resp := GetPromiseResponse{History: []PromiseResponse{}}

	if activeFound {
		consistency, err := s.currentConsistency(ctx, habit, loc)
		if err != nil {
			return GetPromiseResponse{}, err
		}
		r := toPromiseResponse(active, &consistency)
		resp.Active = &r
	}

	if includeHistory {
		history, err := promiseHistory(ctx, s.pool, userID, habitID)
		if err != nil {
			return GetPromiseResponse{}, err
		}
		resp.History = make([]PromiseResponse, len(history))
		for i, p := range history {
			resp.History[i] = toPromiseResponse(p, nil)
		}
	}

	return resp, nil
}

// CancelPromise cancels habitID's active promise, matching CancelPromise in
// PromiseEndpoints.cs — which looks up the promise directly by
// (userID, habitID) with no separate habit-existence check, so a
// missing/foreign/archived habit and a habit with no active promise are
// both indistinguishable 404s here. A lost race against a concurrent
// resolution/archive (cancelPromiseRow's resolved=false — see
// resolvePromise's doc comment in promise_store.go) is ALSO reported as
// ErrNotFound: by the time this call would take effect, the promise it
// found a moment ago is no longer there to cancel.
func (s *Service) CancelPromise(ctx context.Context, userID, habitID string) error {
	if !isValidUUID(habitID) {
		return ErrNotFound
	}
	promise, found, err := findActivePromise(ctx, s.pool, userID, habitID)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}
	_, resolved, err := cancelPromiseRow(ctx, s.pool, promise.ID, s.now().UTC())
	if err != nil {
		return err
	}
	if !resolved {
		return ErrNotFound
	}
	return nil
}

// ToggleVisibility sets an active promise's IsPublicOnFlame flag, matching
// ToggleVisibility in PromiseEndpoints.cs — which, unlike CancelPromise,
// does check the habit exists and isn't archived before looking at the
// promise.
func (s *Service) ToggleVisibility(ctx context.Context, userID, habitID string, req UpdatePromiseVisibilityRequest) (Promise, error) {
	if !isValidUUID(habitID) {
		return Promise{}, ErrNotFound
	}
	if _, found, err := findActiveHabit(ctx, s.pool, userID, habitID); err != nil {
		return Promise{}, err
	} else if !found {
		return Promise{}, ErrNotFound
	}

	promise, found, err := findActivePromise(ctx, s.pool, userID, habitID)
	if err != nil {
		return Promise{}, err
	}
	if !found {
		return Promise{}, ErrNotFound
	}

	return setPromiseVisibility(ctx, s.pool, promise.ID, req.IsPublicOnFlame)
}

// currentConsistency computes habit's weighted consistency in loc using
// Service.now instead of the real wall clock — the promise-resolution
// analogue of habits.Consistency (consistency.go), which reads time.Now()
// directly and so cannot be driven by a test's fake clock. It calls
// Calculate (consistency.go's own explicit-time entry point) rather than
// duplicating any calculation logic.
func (s *Service) currentConsistency(ctx context.Context, habit Habit, loc *time.Location) (float64, error) {
	dates, err := habitCompletionDates(ctx, s.pool, habit.ID)
	if err != nil {
		return 0, err
	}
	today := s.now().In(loc)
	created := habit.CreatedAt.In(loc)
	return Calculate(habit.Frequency, habit.CustomDays, dates, today, created), nil
}
