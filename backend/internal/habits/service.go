package habits

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/events"
)

// ErrFutureDate and ErrOutsideWindow are the two date-range rejections
// CompleteHabit applies, matching CompletionEndpoints.cs exactly. The window
// size comes from ConsistencyCalculator's WindowDays (60): the window is
// [today-59 .. today], so a completion before windowStart is rejected.
var (
	ErrFutureDate    = newFieldError("Cannot log completions in the future")
	ErrOutsideWindow = newFieldError(fmt.Sprintf("Cannot log completions more than %d days in the past", WindowDays-1))
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// isValidUUID reports whether s is a canonical UUID string. A path segment
// that isn't one can never match a row (ids are always real uuids), so
// callers treat this the same way ASP.NET's `{id:guid}` route constraint
// behaves: the route simply doesn't resolve to anything, i.e. 404.
func isValidUUID(s string) bool {
	return uuidPattern.MatchString(s)
}

// Service is the habits module's business logic: it owns the DB pool and
// the shared event hook registry, and is the sole entry point Handlers
// calls into.
type Service struct {
	pool     *pgxpool.Pool
	registry *events.Registry
	logger   *slog.Logger
}

// NewService wires a Service and registers its UserDeleted handler with
// registry — the in-process replacement for UserDeletedSubscriber.cs,
// cascading a deleted account's habits and completions. This is not called
// out as a numbered step in the bead's dispatch, but it is the same data
// the old habit-service cleaned up on user.deleted; leaving it unported
// would silently orphan rows the C# system always removed. Flagged in the
// bead report as a decision beyond the literal step list.
func NewService(pool *pgxpool.Pool, registry *events.Registry, logger *slog.Logger) *Service {
	s := &Service{pool: pool, registry: registry, logger: logger}
	events.Register(registry, s.handleUserDeleted)
	return s
}

func (s *Service) handleUserDeleted(ctx context.Context, event events.UserDeleted) error {
	if err := deleteUserData(ctx, s.pool, event.UserID); err != nil {
		return fmt.Errorf("habits: cascading user.deleted: %w", err)
	}
	return nil
}

// CreateHabit validates req, defaults Frequency to Daily when omitted
// (matching .NET's populateMissingResolver filling a missing non-nullable
// enum property with its default value), and emits HabitCreated.
func (s *Service) CreateHabit(ctx context.Context, userID string, req CreateHabitRequest) (Habit, error) {
	name, err := validateName(req.Name)
	if err != nil {
		return Habit{}, err
	}
	req.Name = name

	frequency := FrequencyDaily
	if req.Frequency != nil {
		frequency = *req.Frequency
	}

	var customDays []int
	if frequency.requiresCustomDays() {
		if len(req.CustomDays) == 0 {
			return Habit{}, newFieldError("CustomDays required for Weekly and Custom frequency")
		}
		customDays = req.CustomDays
	}

	if err := validateMinimumDescriptionLength(req.MinimumDescription); err != nil {
		return Habit{}, err
	}

	habit, err := createHabit(ctx, s.pool, userID, req, frequency, customDays)
	if err != nil {
		return Habit{}, err
	}

	if err := events.Emit(ctx, s.registry, events.HabitCreated{UserID: userID, HabitID: habit.ID, Name: habit.Name}); err != nil {
		s.logger.ErrorContext(ctx, "habit.created handler failed; habit already committed", "habit_id", habit.ID, "error", err)
	}

	return habit, nil
}

// ListHabits returns userID's non-archived habits.
func (s *Service) ListHabits(ctx context.Context, userID string) ([]Habit, error) {
	return listHabits(ctx, s.pool, userID)
}

// GetHabit returns ErrNotFound for a missing, archived, or
// other-user-owned habit — the query itself is scoped by user_id, so a
// habit belonging to someone else is indistinguishable from a habit that
// does not exist, matching HabitEndpoints.cs's GetHabit (404, never 403).
func (s *Service) GetHabit(ctx context.Context, userID, id string) (Habit, error) {
	if !isValidUUID(id) {
		return Habit{}, ErrNotFound
	}
	habit, found, err := findActiveHabit(ctx, s.pool, userID, id)
	if err != nil {
		return Habit{}, err
	}
	if !found {
		return Habit{}, ErrNotFound
	}
	return habit, nil
}

// UpdateHabit applies UpdateHabitRequest's per-field "omitted vs provided"
// rules and the Frequency/CustomDays interaction exactly as UpdateHabit in
// HabitEndpoints.cs does — see that method's inline comments for the two
// distinct "CustomDays" error messages this ports.
func (s *Service) UpdateHabit(ctx context.Context, userID, id string, req UpdateHabitRequest) (Habit, error) {
	habit, err := s.GetHabit(ctx, userID, id)
	if err != nil {
		return Habit{}, err
	}

	if req.Name != nil {
		name, err := validateName(*req.Name)
		if err != nil {
			return Habit{}, err
		}
		habit.Name = name
	}
	if req.Icon != nil {
		habit.Icon = trimPtr(req.Icon)
	}
	if req.Color != nil {
		habit.Color = trimPtr(req.Color)
	}

	switch {
	case req.Frequency != nil:
		if req.Frequency.requiresCustomDays() && len(req.CustomDays) == 0 {
			return Habit{}, newFieldError("CustomDays required for Weekly and Custom frequency")
		}
		habit.Frequency = *req.Frequency
		if req.Frequency.requiresCustomDays() {
			habit.CustomDays = req.CustomDays
		} else {
			habit.CustomDays = nil
		}
	case req.CustomDays != nil && habit.Frequency.requiresCustomDays():
		if len(req.CustomDays) == 0 {
			return Habit{}, newFieldError("CustomDays cannot be empty for Weekly and Custom frequency")
		}
		habit.CustomDays = req.CustomDays
	}

	switch {
	case req.ClearMinimumDescription != nil && *req.ClearMinimumDescription:
		habit.MinimumDescription = nil
	case req.MinimumDescription != nil:
		if err := validateMinimumDescriptionLength(req.MinimumDescription); err != nil {
			return Habit{}, err
		}
		habit.MinimumDescription = trimToNil(req.MinimumDescription)
	}

	return updateHabit(ctx, s.pool, habit)
}

// ArchiveHabit soft-deletes a habit (idempotent) and emits HabitArchived.
// The lookup here — unlike every other habits operation — does not filter
// out already-archived habits, matching DeleteHabit's query in
// HabitEndpoints.cs exactly (no ArchivedAt condition), which is what makes
// archiving an already-archived habit succeed again instead of 404ing.
//
// INTEGRATION POINT (winzy.ai-rdc7.3.3): the C# DeleteHabit also cancels
// any active Promise for this habit before archiving it. Promises do not
// exist in this bead (no table, no package) — when winzy.ai-rdc7.3.3 lands
// Flame Promises, its cancel-on-archive logic belongs right here, before
// the archiveHabit call below.
func (s *Service) ArchiveHabit(ctx context.Context, userID, id string) error {
	if !isValidUUID(id) {
		return ErrNotFound
	}
	habit, found, err := findHabitAnyArchiveState(ctx, s.pool, userID, id)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}

	if _, err := archiveHabit(ctx, s.pool, habit.ID); err != nil {
		return err
	}

	if err := events.Emit(ctx, s.registry, events.HabitArchived{UserID: userID, HabitID: habit.ID}); err != nil {
		s.logger.ErrorContext(ctx, "habit.archived handler failed; archive already committed", "habit_id", habit.ID, "error", err)
	}
	return nil
}

// CompleteHabit resolves the IANA timezone, computes (or accepts) the
// local date, validates it falls within [today-59, today] and Honest
// Minimums rules, inserts a new completion, then recomputes the habit's
// weighted consistency over all completions (including the new one) in the
// request timezone — matching CompleteHabit in CompletionEndpoints.cs, which
// loads every completion and calls ConsistencyCalculator.Calculate(habit,
// map, tz) after saving. The consistency is returned to the caller (for the
// HTTP response's "consistency" field) and carried in the HabitCompleted
// event, exactly as the C# does.
func (s *Service) CompleteHabit(ctx context.Context, userID, habitID string, req CompleteHabitRequest) (Completion, float64, error) {
	if !isValidUUID(habitID) {
		return Completion{}, 0, ErrNotFound
	}
	habit, found, err := findActiveHabit(ctx, s.pool, userID, habitID)
	if err != nil {
		return Completion{}, 0, err
	}
	if !found {
		return Completion{}, 0, ErrNotFound
	}

	loc, err := resolveTimezone(req.Timezone)
	if err != nil {
		return Completion{}, 0, err
	}

	var localDate time.Time
	if req.Date != nil {
		parsed, ok := parseISODate(*req.Date)
		if !ok {
			return Completion{}, 0, newFieldError(fmt.Sprintf("Invalid date format: %s", *req.Date))
		}
		localDate = parsed
	} else {
		localDate = todayInLocation(loc)
	}

	userToday := todayInLocation(loc)
	if localDate.After(userToday) {
		return Completion{}, 0, ErrFutureDate
	}
	windowStart := userToday.AddDate(0, 0, -(WindowDays - 1))
	if localDate.Before(windowStart) {
		return Completion{}, 0, ErrOutsideWindow
	}

	kind := CompletionFull
	if req.CompletionKind != nil {
		kind = *req.CompletionKind
	}
	if !kind.validForLogging() {
		return Completion{}, 0, newFieldError("Invalid completionKind. Must be 'full' or 'minimum'")
	}
	if kind == CompletionMinimum && emptyDescription(habit.MinimumDescription) {
		return Completion{}, 0, newFieldError("Cannot log minimum completion for a habit without a configured minimum description")
	}

	completion, err := createCompletion(ctx, s.pool, habitID, userID, localDate, kind)
	if err != nil {
		return Completion{}, 0, err
	}

	// Recompute weighted consistency over ALL completions (the new one
	// included) in the request timezone — the same source and order as the
	// C#: load-all, then Calculate(habit, map, tz). A read failure here must
	// not fail an already-committed completion, so on error we fall back to 0
	// (the event's consistency is best-effort enrichment) and log.
	dates, err := habitCompletionDates(ctx, s.pool, habitID)
	if err != nil {
		s.logger.ErrorContext(ctx, "loading completions for consistency; completion already committed", "habit_id", habitID, "error", err)
		dates = nil
	}
	consistency := Consistency(habit, dates, loc)

	if err := events.Emit(ctx, s.registry, events.HabitCompleted{
		UserID:         userID,
		HabitID:        habitID,
		Date:           localDate,
		Consistency:    consistency,
		Timezone:       req.Timezone,
		HabitName:      habit.Name,
		CompletionKind: events.CompletionKind(kind.dbValue()),
	}); err != nil {
		s.logger.ErrorContext(ctx, "habit.completed handler failed; completion already committed", "habit_id", habitID, "error", err)
	}

	return completion, consistency, nil
}

// DeleteCompletion removes a completion by (habitID, date), scoped
// directly to userID on the completions row — see
// findCompletionByHabitDateUser's doc comment for why this needs no join
// back to habits. habitID is validated as a UUID first (matching
// CompletionEndpoints.cs's `{id:guid}` route constraint on this endpoint,
// which never even dispatches to the handler for a malformed id, so ASP.NET
// falls through to a 404): without this guard a malformed id would reach
// the `::uuid` cast in the query and fail with a 500 instead.
func (s *Service) DeleteCompletion(ctx context.Context, userID, habitID, dateStr string) (bool, error) {
	if !isValidUUID(habitID) {
		return false, nil
	}
	localDate, ok := parseISODate(dateStr)
	if !ok {
		return false, newFieldError(fmt.Sprintf("Invalid date format: %s", dateStr))
	}
	completion, found, err := findCompletionByHabitDateUser(ctx, s.pool, habitID, localDate, userID)
	if err != nil {
		return false, err
	}
	if !found {
		return false, nil
	}
	if err := deleteCompletionRow(ctx, s.pool, completion.ID); err != nil {
		return false, err
	}
	return true, nil
}

// UpdateCompletion corrects an existing completion's kind, re-checking
// Honest Minimums against the parent habit's current MinimumDescription —
// matching UpdateCompletion in CompletionEndpoints.cs (which .Include()s
// the Habit for exactly this check). habitID is validated as a UUID first —
// see DeleteCompletion's doc comment for why (this endpoint has the same
// `{id:guid}` route constraint in the C# source).
func (s *Service) UpdateCompletion(ctx context.Context, userID, habitID, dateStr string, kind CompletionKind) (Completion, bool, error) {
	if !isValidUUID(habitID) {
		return Completion{}, false, nil
	}
	localDate, ok := parseISODate(dateStr)
	if !ok {
		return Completion{}, false, newFieldError(fmt.Sprintf("Invalid date format: %s", dateStr))
	}
	if !kind.validForLogging() {
		return Completion{}, false, newFieldError("Invalid completionKind. Must be 'full' or 'minimum'")
	}

	completion, found, err := findCompletionByHabitDateUser(ctx, s.pool, habitID, localDate, userID)
	if err != nil {
		return Completion{}, false, err
	}
	if !found {
		return Completion{}, false, nil
	}

	if kind == CompletionMinimum {
		habit, habitFound, err := findHabitAnyArchiveState(ctx, s.pool, userID, habitID)
		if err != nil {
			return Completion{}, false, err
		}
		if !habitFound || emptyDescription(habit.MinimumDescription) {
			return Completion{}, false, newFieldError("Cannot set minimum completion for a habit without a configured minimum description")
		}
	}

	updated, err := updateCompletionKind(ctx, s.pool, completion.ID, kind)
	if err != nil {
		return Completion{}, false, err
	}
	return updated, true, nil
}

// CompletionsByDate returns every active habit for userID with its
// completion status on dateStr, matching GetCompletionsByDate in
// CompletionEndpoints.cs.
func (s *Service) CompletionsByDate(ctx context.Context, userID, dateStr string) (CompletionsByDateResponse, error) {
	localDate, ok := parseISODate(dateStr)
	if !ok {
		return CompletionsByDateResponse{}, newFieldError(fmt.Sprintf("Invalid date format: %s", dateStr))
	}

	rows, err := completionsForDate(ctx, s.pool, userID, localDate)
	if err != nil {
		return CompletionsByDateResponse{}, err
	}

	habitsOut := make([]HabitCompletionForDate, len(rows))
	for i, r := range rows {
		habitsOut[i] = HabitCompletionForDate{
			ID:                 r.Habit.ID,
			Name:               r.Habit.Name,
			Icon:               r.Habit.Icon,
			Color:              r.Habit.Color,
			MinimumDescription: r.Habit.MinimumDescription,
			Completed:          r.Completed,
			CompletionKind:     r.CompletionKind,
		}
	}

	return CompletionsByDateResponse{Date: formatISODate(localDate), Habits: habitsOut}, nil
}

// HabitStats builds GET /habits/{id}/stats's payload for an owner: it
// resolves "today" and the habit's creation date in timezone (an owner
// surface — the X-Timezone header, IANA, invalid -> 400), computes weighted
// consistency and the flame level over all completions, and reports the
// window counters — field-for-field the same as GetStats in
// CompletionEndpoints.cs. The caller (handlers.go) has already rejected a
// missing X-Timezone header with the header-specific message; an invalid
// (but present) id here maps to "Invalid timezone: {tz}" via resolveTimezone,
// matching the C#.
func (s *Service) HabitStats(ctx context.Context, userID, habitID, timezone string) (HabitStatsResponse, error) {
	if !isValidUUID(habitID) {
		return HabitStatsResponse{}, ErrNotFound
	}

	loc, err := resolveTimezone(timezone)
	if err != nil {
		return HabitStatsResponse{}, err
	}

	habit, found, err := findActiveHabit(ctx, s.pool, userID, habitID)
	if err != nil {
		return HabitStatsResponse{}, err
	}
	if !found {
		return HabitStatsResponse{}, ErrNotFound
	}

	dates, err := habitCompletionDates(ctx, s.pool, habitID)
	if err != nil {
		return HabitStatsResponse{}, err
	}

	consistency := Consistency(habit, dates, loc)
	flame := GetFlameLevel(consistency, nil)

	today := civilFromTime(time.Now().In(loc))
	windowStart := today.addDays(-(WindowDays - 1))

	completionsInWindow := 0
	completedToday := false
	var completedTodayKind *string
	entries := make([]CompletionDateEntry, 0, len(dates))
	for _, d := range dates {
		cd := civilFromTime(d.LocalDate)
		if !cd.before(windowStart) && !cd.after(today) {
			completionsInWindow++
		}
		if cd == today {
			completedToday = true
			kind := d.Kind.String()
			completedTodayKind = &kind
		}
		entries = append(entries, CompletionDateEntry{
			Date:           formatISODate(d.LocalDate),
			CompletionKind: d.Kind.String(),
		})
	}

	return HabitStatsResponse{
		HabitID:             habitID,
		Consistency:         consistency,
		FlameLevel:          flame.String(),
		TotalCompletions:    len(dates),
		CompletionsInWindow: completionsInWindow,
		CompletedToday:      completedToday,
		CompletedTodayKind:  completedTodayKind,
		WindowDays:          WindowDays,
		WindowStart:         formatISODate(windowStart.t()),
		Today:               formatISODate(today.t()),
		CompletedDates:      entries,
	}, nil
}

// resolveTimezone parses tz as an IANA timezone identifier, matching
// CompletionEndpoints.cs's TimeZoneInfo.FindSystemTimeZoneById error
// handling (empty or unrecognized -> 400).
func resolveTimezone(tz string) (*time.Location, error) {
	if tz == "" {
		return nil, newFieldError("Timezone is required")
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, newFieldError(fmt.Sprintf("Invalid timezone: %s", tz))
	}
	return loc, nil
}

func emptyDescription(desc *string) bool {
	return desc == nil || len(*desc) == 0
}

// isNotFound is a small helper so handlers.go can share one mapping branch.
func isNotFound(err error) bool {
	return errors.Is(err, ErrNotFound)
}
