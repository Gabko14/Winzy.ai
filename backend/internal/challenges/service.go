package challenges

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/db"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/habits"
	"github.com/Gabko14/winzy/backend/internal/social"
)

// Service is the challenges module's business logic.
type Service struct {
	pool           *pgxpool.Pool
	registry       *events.Registry
	logger         *slog.Logger
	auth           *auth.Service
	social         *social.Service
	habits         *habits.Service
	publicBaseURL  string
	now            func() time.Time
	claimInterrupt func() error // tests only: fail mid-claim to assert rollback
}

// NewService wires a Service, registers HabitCompleted/UserDeleted handlers,
// and registers the "challenge" export section (C# singular literal).
// publicBaseURL is the origin used to build share URLs (/ci/{token}).
func NewService(
	pool *pgxpool.Pool,
	registry *events.Registry,
	exportReg *export.Registry,
	authSvc *auth.Service,
	socialSvc *social.Service,
	habitsSvc *habits.Service,
	logger *slog.Logger,
	publicBaseURL string,
) *Service {
	s := &Service{
		pool: pool, registry: registry, logger: logger,
		auth: authSvc, social: socialSvc, habits: habitsSvc,
		publicBaseURL: publicBaseURL,
		now:           func() time.Time { return time.Now().UTC() },
	}
	events.Register(registry, s.handleHabitCompleted)
	events.Register(registry, s.handleUserDeleted)
	exportReg.Register("challenge", s.exportSection)
	return s
}

// SetClock overrides the clock (tests).
func (s *Service) SetClock(now func() time.Time) {
	s.now = now
}

// SetClaimInterrupt injects a failure after the habit is created inside
// ClaimInvite (tests) so the surrounding transaction must roll everything
// back — friendship, habit, challenge, and the invite claim mark.
func (s *Service) SetClaimInterrupt(fn func() error) {
	s.claimInterrupt = fn
}

// Create creates a challenge from creatorID onto a friend's habit.
func (s *Service) Create(ctx context.Context, creatorID string, req CreateChallengeRequest) (Challenge, error) {
	if err := validateCreateRequest(creatorID, req); err != nil {
		return Challenge{}, err
	}

	if req.MilestoneType == MilestoneCustomDateRange {
		if req.CustomStartDate == nil || req.CustomEndDate == nil {
			return Challenge{}, newFieldError("CustomStartDate and CustomEndDate are required for CustomDateRange")
		}
		if !req.CustomEndDate.After(*req.CustomStartDate) {
			return Challenge{}, newFieldError("CustomEndDate must be after CustomStartDate")
		}
		if !req.CustomEndDate.After(s.now()) {
			return Challenge{}, newFieldError("CustomEndDate must be in the future")
		}
	}

	friends, err := s.social.AreFriends(ctx, creatorID, req.RecipientID)
	if err != nil {
		s.logger.WarnContext(ctx, "friendship check failed",
			"creator_id", creatorID, "recipient_id", req.RecipientID, "error", err)
		return Challenge{}, ErrUnavailable
	}
	if !friends {
		return Challenge{}, newFieldError("You can only challenge friends")
	}

	now := s.now()
	if err := expireStaleActive(ctx, s.pool, creatorID, req.RecipientID, req.HabitID, now); err != nil {
		return Challenge{}, err
	}

	endsAt := now.AddDate(0, 0, req.PeriodDays)
	if req.MilestoneType == MilestoneCustomDateRange && req.CustomEndDate != nil {
		endsAt = *req.CustomEndDate
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Challenge{}, fmt.Errorf("challenges: beginning create transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	challenge, err := insertChallenge(ctx, tx, Challenge{
		HabitID: req.HabitID, CreatorID: creatorID, RecipientID: req.RecipientID,
		MilestoneType: req.MilestoneType, TargetValue: req.TargetValue, PeriodDays: req.PeriodDays,
		RewardDescription: strings.TrimSpace(req.RewardDescription),
		Status:            StatusActive, EndsAt: endsAt,
		CustomStartDate: req.CustomStartDate, CustomEndDate: req.CustomEndDate,
	})
	if err != nil {
		if errors.Is(err, ErrConflict) {
			return Challenge{}, newConflictError("An active challenge already exists for this habit and recipient")
		}
		return Challenge{}, err
	}

	// Emit ChallengeCreated in the same transaction — intentional improvement
	// over C#'s publish-after-save (and over publish-before-save for
	// ChallengeCompleted): handlers see a consistent committed-or-rolled-back
	// state rather than a durability workaround.
	if err := events.Emit(db.WithQuerier(ctx, tx), s.registry, events.ChallengeCreated{
		ChallengeID: challenge.ID, From: creatorID, To: req.RecipientID, HabitID: req.HabitID,
	}); err != nil {
		return Challenge{}, fmt.Errorf("challenges: emitting challenge.created: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Challenge{}, fmt.Errorf("challenges: committing create: %w", err)
	}
	return challenge, nil
}

// List returns paginated challenges for userID with derived-status filtering.
func (s *Service) List(ctx context.Context, userID string, page, pageSize int, status string, since *time.Time) (listChallengesResponse, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 1
	}
	if pageSize > 100 {
		pageSize = 100
	}

	f := listFilter{UserID: userID, Since: since, Now: s.now(), Page: page, Size: pageSize}
	if status != "" {
		parsed, ok := parseChallengeStatus(status)
		if ok {
			f.Status = &parsed
		}
	}

	total, err := countChallenges(ctx, s.pool, f)
	if err != nil {
		return listChallengesResponse{}, err
	}
	items, err := listChallenges(ctx, s.pool, f)
	if err != nil {
		return listChallengesResponse{}, err
	}

	creatorIDs := make([]string, 0, len(items))
	seen := map[string]struct{}{}
	for _, c := range items {
		if _, ok := seen[c.CreatorID]; !ok {
			seen[c.CreatorID] = struct{}{}
			creatorIDs = append(creatorIDs, c.CreatorID)
		}
	}
	names := s.fetchDisplayNames(ctx, creatorIDs)

	now := s.now()
	out := make([]challengeDetailResponse, len(items))
	for i, c := range items {
		out[i] = toChallengeDetailResponse(c, now, names[c.CreatorID])
	}
	return listChallengesResponse{Items: out, Page: page, PageSize: pageSize, Total: total}, nil
}

// Get returns one challenge the user participates in.
func (s *Service) Get(ctx context.Context, userID, id string) (challengeDetailResponse, error) {
	c, found, err := findChallengeForUser(ctx, s.pool, id, userID)
	if err != nil {
		return challengeDetailResponse{}, err
	}
	if !found {
		return challengeDetailResponse{}, ErrNotFound
	}
	names := s.fetchDisplayNames(ctx, []string{c.CreatorID})
	return toChallengeDetailResponse(c, s.now(), names[c.CreatorID]), nil
}

// Claim transitions Completed -> Claimed for a participant.
func (s *Service) Claim(ctx context.Context, userID, id string) (Challenge, error) {
	c, found, err := findChallengeForUser(ctx, s.pool, id, userID)
	if err != nil {
		return Challenge{}, err
	}
	if !found {
		return Challenge{}, ErrNotFound
	}
	if c.Status != StatusCompleted {
		return Challenge{}, newFieldError("Only completed challenges can be claimed")
	}
	claimed, ok, err := updateChallengeClaimed(ctx, s.pool, c.ID, s.now())
	if err != nil {
		return Challenge{}, err
	}
	if !ok {
		// Lost a concurrent claim race — same 400 as the pre-check.
		return Challenge{}, newFieldError("Only completed challenges can be claimed")
	}
	return claimed, nil
}

// Cancel lets the creator cancel a non-completed challenge.
func (s *Service) Cancel(ctx context.Context, userID, id string) error {
	c, found, err := findChallengeForCreator(ctx, s.pool, id, userID)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}
	if c.Status == StatusCompleted || c.Status == StatusClaimed {
		return newFieldError("Cannot cancel a completed challenge")
	}
	ok, err := updateChallengeCancelled(ctx, s.pool, c.ID, s.now())
	if err != nil {
		return err
	}
	if !ok {
		return newFieldError("Cannot cancel a completed challenge")
	}
	return nil
}

func (s *Service) fetchDisplayNames(ctx context.Context, userIDs []string) map[string]*string {
	out := map[string]*string{}
	if len(userIDs) == 0 {
		return out
	}
	profiles, err := s.auth.BatchProfiles(ctx, userIDs)
	if err != nil {
		s.logger.WarnContext(ctx, "batch profiles failed", "error", err)
		return out
	}
	for _, p := range profiles {
		if p.DisplayName != nil {
			out[p.UserID] = p.DisplayName
		}
	}
	return out
}

// handleHabitCompleted is the progress engine — port of HabitCompletedSubscriber.cs.
// Opens its OWN transaction (habit.completed is emitted post-commit by
// habits.CompleteHabit — deliberately isolated so a progress bug never
// blocks habit logging). Inside that tx: progress updates + ChallengeCompleted
// emit. See PM SPEC CORRECTION on winzy.ai-rdc7.5.
func (s *Service) handleHabitCompleted(ctx context.Context, event events.HabitCompleted) error {
	now := s.now()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("challenges: beginning habit.completed transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	active, err := listActiveForHabitRecipient(ctx, tx, event.HabitID, event.UserID, now)
	if err != nil {
		return fmt.Errorf("challenges: cascading habit.completed: %w", err)
	}
	if len(active) == 0 {
		s.logger.DebugContext(ctx, "no active challenges for habit completion",
			"habit_id", event.HabitID, "user_id", event.UserID)
		return nil
	}

	completionDate := time.Date(event.Date.Year(), event.Date.Month(), event.Date.Day(), 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	txCtx := db.WithQuerier(ctx, tx)

	for i := range active {
		challenge := &active[i]
		if err := s.applyCompletion(txCtx, tx, challenge, event, completionDate, now); err != nil {
			return err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("challenges: committing habit.completed transaction: %w", err)
	}
	return nil
}

func (s *Service) applyCompletion(
	ctx context.Context,
	q querier,
	challenge *Challenge,
	event events.HabitCompleted,
	completionDate string,
	now time.Time,
) error {
	oldProgress := challenge.CurrentProgress

	switch challenge.MilestoneType {
	case MilestoneDaysInPeriod, MilestoneTotalCompletions:
		challengeStart := challenge.CreatedAt.UTC().Format("2006-01-02")
		if completionDate < challengeStart {
			s.logger.DebugContext(ctx, "skipping completion before challenge creation",
				"challenge_id", challenge.ID, "date", completionDate, "created_at", challenge.CreatedAt)
			return nil
		}
		processed := challenge.GetProcessedDates()
		if _, exists := processed[completionDate]; exists {
			s.logger.DebugContext(ctx, "completion date already processed, skipping",
				"challenge_id", challenge.ID, "date", completionDate)
			return nil
		}
		processed[completionDate] = struct{}{}
		challenge.SetProcessedDates(processed)

	case MilestoneCustomDateRange:
		rangeStart := challenge.CreatedAt.UTC().Format("2006-01-02")
		if challenge.CustomStartDate != nil {
			rangeStart = challenge.CustomStartDate.UTC().Format("2006-01-02")
		}
		if completionDate < rangeStart {
			s.logger.DebugContext(ctx, "skipping completion before custom range start",
				"challenge_id", challenge.ID, "date", completionDate, "range_start", rangeStart)
			return nil
		}
		processed := challenge.GetProcessedDates()
		if _, exists := processed[completionDate]; exists {
			s.logger.DebugContext(ctx, "completion date already processed, skipping",
				"challenge_id", challenge.ID, "date", completionDate)
			return nil
		}
		// Eligible date — ProcessedCompletionDates is updated only after the
		// range-consistency lookup succeeds (below).

	case MilestoneImprovementMilestone:
		challengeStart := challenge.CreatedAt.UTC().Format("2006-01-02")
		if completionDate < challengeStart {
			s.logger.DebugContext(ctx, "skipping improvement completion before challenge creation",
				"challenge_id", challenge.ID, "date", completionDate)
			return nil
		}
		if challenge.BaselineConsistency == nil {
			baseline := event.Consistency
			challenge.BaselineConsistency = &baseline
			s.logger.InfoContext(ctx, "challenge baseline captured",
				"challenge_id", challenge.ID, "baseline", baseline)
		}
	}

	effectiveConsistency := event.Consistency
	if challenge.MilestoneType == MilestoneCustomDateRange {
		rangeConsistency, ok, err := s.rangeConsistency(ctx, *challenge, event.Timezone)
		if err != nil {
			// Soft-skip WITHOUT persisting this date into ProcessedCompletionDates
			// — intentional divergence from HabitCompletedSubscriber.cs, which
			// mutates the tracked entity's processed-date set before the range
			// call and SaveChanges at the end, so a failed range lookup
			// permanently burns the date. Skipping without persist lets the
			// next habit.completed retry the range lookup for this date.
			s.logger.WarnContext(ctx, "skipping CustomDateRange progress — range consistency unavailable",
				"challenge_id", challenge.ID, "error", err)
			return nil
		}
		if !ok {
			s.logger.WarnContext(ctx, "skipping CustomDateRange progress — habit not found",
				"challenge_id", challenge.ID, "habit_id", challenge.HabitID)
			return nil
		}
		effectiveConsistency = rangeConsistency
		processed := challenge.GetProcessedDates()
		processed[completionDate] = struct{}{}
		challenge.SetProcessedDates(processed)
	}

	mctx := MilestoneContext{Consistency: effectiveConsistency, EventDate: timeCivil(completionDate)}
	challenge.CurrentProgress = CalculateProgress(*challenge, mctx)

	s.logger.DebugContext(ctx, "challenge progress updated",
		"challenge_id", challenge.ID,
		"milestone_type", string(challenge.MilestoneType),
		"old_progress", oldProgress,
		"new_progress", challenge.CurrentProgress,
	)

	if IsMilestoneReached(*challenge, mctx) {
		challenge.Status = StatusCompleted
		challenge.CurrentProgress = 1.0
		completedAt := now
		challenge.CompletedAt = &completedAt
		s.logger.InfoContext(ctx, "challenge completed",
			"challenge_id", challenge.ID,
			"milestone_type", string(challenge.MilestoneType),
			"reward", challenge.RewardDescription,
		)
	}

	if err := updateChallengeProgress(ctx, q, *challenge, now); err != nil {
		return fmt.Errorf("challenges: persisting progress for %s: %w", challenge.ID, err)
	}

	if challenge.Status == StatusCompleted && challenge.CompletedAt != nil {
		// Emit ChallengeCompleted in the same transaction as the status write
		// — intentional improvement over C#'s publish-before-save durability
		// workaround (HabitCompletedSubscriber.cs lines 178-188).
		if err := events.Emit(ctx, s.registry, events.ChallengeCompleted{
			ChallengeID: challenge.ID,
			UserID:      event.UserID,
			Reward:      challenge.RewardDescription,
		}); err != nil {
			return fmt.Errorf("challenges: emitting challenge.completed: %w", err)
		}
	}
	return nil
}

func (s *Service) rangeConsistency(ctx context.Context, challenge Challenge, timezone string) (float64, bool, error) {
	// Normalize to UTC civil dates — C# HabitCompletedSubscriber.cs:204-209
	// uses .UtcDateTime explicitly; pgx may return timestamptz with a non-UTC
	// location, which would shift Year/Month/Day extraction otherwise.
	from := challenge.CreatedAt.UTC()
	if challenge.CustomStartDate != nil {
		from = challenge.CustomStartDate.UTC()
	}
	to := s.now().UTC()
	if challenge.CustomEndDate != nil {
		to = challenge.CustomEndDate.UTC()
	}
	return s.habits.ConsistencyForDateRange(ctx, challenge.HabitID, from, to, timezone)
}

func (s *Service) handleUserDeleted(ctx context.Context, event events.UserDeleted) error {
	q := db.QuerierFrom(ctx, s.pool)
	deleted, err := deleteUserChallenges(ctx, q, event.UserID)
	if err != nil {
		return fmt.Errorf("challenges: cascading user.deleted: %w", err)
	}
	s.logger.InfoContext(ctx, "deleted challenges for user",
		"user_id", event.UserID, "count", deleted)

	invitesDeleted, err := deleteUserInvites(ctx, q, event.UserID)
	if err != nil {
		return fmt.Errorf("challenges: cascading user.deleted invites: %w", err)
	}
	s.logger.InfoContext(ctx, "deleted challenge invites for user",
		"user_id", event.UserID, "count", invitesDeleted)
	return nil
}
