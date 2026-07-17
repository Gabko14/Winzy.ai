package social

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"regexp"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/db"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/habits"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// isValidUUID reports whether s is a canonical UUID string — see
// habits/store.go's identical helper for the "a malformed id can never match
// a row" rationale this mirrors.
func isValidUUID(s string) bool {
	return uuidPattern.MatchString(s)
}

// Service is the social module's business logic: it owns the DB pool, the
// shared event hook registry, and direct references to auth.Service and
// habits.Service — social may import both directly (no import cycle in this
// direction; habits and auth never import social), using auth's exported
// batch-profile lookup for friend-list enrichment and habits' exported
// ownership/consistency reads for visibility validation and flame
// enrichment. The reverse direction (habits' public flame surfaces filtering
// through social's visibility rules) instead goes through the narrow
// habits.PublicVisibilityFilter interface habits defines and this Service
// satisfies structurally — see crossmodule.go.
type Service struct {
	pool     *pgxpool.Pool
	registry *events.Registry
	logger   *slog.Logger
	auth     *auth.Service
	habits   *habits.Service
}

// NewService wires a Service, registers its HabitCreated/HabitArchived/
// UserDeleted handlers with registry — the in-process replacement for
// HabitCreatedSubscriber.cs/HabitArchivedSubscriber.cs/
// UserDeletedSubscriber.cs — and registers its export.Section into exportReg
// under the name "social" (singular, matching InternalEndpoints.cs's
// `service = "social"` literal exactly — NOT the module/package name, which
// happens to already be singular here but the rule is the same lesson
// winzy.ai-rdc7.3.3 learned for "habit").
func NewService(pool *pgxpool.Pool, registry *events.Registry, exportReg *export.Registry, authSvc *auth.Service, habitsSvc *habits.Service, logger *slog.Logger) *Service {
	s := &Service{pool: pool, registry: registry, logger: logger, auth: authSvc, habits: habitsSvc}
	events.Register(registry, s.handleHabitCreated)
	events.Register(registry, s.handleHabitArchived)
	events.Register(registry, s.handleUserDeleted)
	exportReg.Register("social", s.exportSection)
	return s
}

// --- event hook handlers (winzy.ai-rdc7.13 contract: resolve the querier via
// db.QuerierFrom so a write here joins whatever transaction the emitter
// holds, falling back to s.pool when there is none — see internal/events'
// package doc and habits.Service.handleUserDeleted for the reference
// implementation). ---

// handleHabitCreated inserts a VisibilitySetting at the owner's default
// habit visibility — idempotent via ON CONFLICT DO NOTHING, matching
// HabitCreatedSubscriber.cs's existence check (tolerates redelivery/double-fire
// without erroring or overwriting an already-initialized row).
func (s *Service) handleHabitCreated(ctx context.Context, event events.HabitCreated) error {
	q := db.QuerierFrom(ctx, s.pool)
	defaultVisibility, err := defaultVisibilityFor(ctx, q, event.UserID)
	if err != nil {
		return fmt.Errorf("social: resolving default visibility for habit.created: %w", err)
	}
	if err := insertVisibilitySettingIfAbsent(ctx, q, event.UserID, event.HabitID, defaultVisibility); err != nil {
		return fmt.Errorf("social: cascading habit.created: %w", err)
	}
	return nil
}

// handleHabitArchived deletes the habit's VisibilitySetting — naturally
// idempotent (DELETE of a missing row is a no-op), matching
// HabitArchivedSubscriber.cs.
func (s *Service) handleHabitArchived(ctx context.Context, event events.HabitArchived) error {
	q := db.QuerierFrom(ctx, s.pool)
	if err := deleteVisibilitySetting(ctx, q, event.UserID, event.HabitID); err != nil {
		return fmt.Errorf("social: cascading habit.archived: %w", err)
	}
	return nil
}

// handleUserDeleted removes every social row for the deleted user — witness
// link habits, witness links, preferences, visibility settings, and
// friendships (both directions) — matching UserDeletedSubscriber.cs.
func (s *Service) handleUserDeleted(ctx context.Context, event events.UserDeleted) error {
	q := db.QuerierFrom(ctx, s.pool)
	if err := deleteUserData(ctx, q, event.UserID); err != nil {
		return fmt.Errorf("social: cascading user.deleted: %w", err)
	}
	return nil
}

// --- friends ---

// SendFriendRequest creates a Pending friendship request from userID to
// friendID, matching SendFriendRequest in FriendEndpoints.cs: rejects a
// missing/empty FriendId and a self-request, and 409s on any existing
// relationship in either direction (Accepted -> "Already friends", Pending
// -> "Friend request already exists"). friendID is "" for an omitted field,
// a blank string, or the literal all-zero UUID — see friendIDValue's doc
// comment for why the handler collapses those cases before calling this.
func (s *Service) SendFriendRequest(ctx context.Context, userID, friendID string) (Friendship, error) {
	if friendID == "" {
		return Friendship{}, newFieldError("FriendId is required")
	}
	if friendID == userID {
		return Friendship{}, newFieldError("Cannot send friend request to yourself")
	}

	existing, found, err := findFriendshipEitherDirection(ctx, s.pool, userID, friendID)
	if err != nil {
		return Friendship{}, err
	}
	if found {
		if existing.Status == FriendshipAccepted {
			return Friendship{}, newConflictError("Already friends")
		}
		return Friendship{}, newConflictError("Friend request already exists")
	}

	friendship, err := insertFriendship(ctx, s.pool, userID, friendID, FriendshipPending)
	if err != nil {
		if errors.Is(err, ErrConflict) {
			return Friendship{}, newConflictError("Friend request already exists")
		}
		return Friendship{}, err
	}

	if err := events.Emit(ctx, s.registry, events.FriendRequestSent{From: userID, To: friendID}); err != nil {
		s.logger.ErrorContext(ctx, "friend.request.sent handler failed; request already committed", "friendship_id", friendship.ID, "error", err)
	}

	return friendship, nil
}

// AcceptFriendRequest transitions a Pending request to Accepted and creates
// the reverse friendship row, matching AcceptFriendRequest in
// FriendEndpoints.cs. Only the request's recipient (friend_id) may accept
// it — the sender attempting to accept their own request, or any
// non-existent/non-pending id, is ErrNotFound (never a distinct 403).
func (s *Service) AcceptFriendRequest(ctx context.Context, userID, id string) (Friendship, error) {
	if !isValidUUID(id) {
		return Friendship{}, ErrNotFound
	}

	// The forward UPDATE (Pending -> Accepted) and the reverse INSERT are one
	// atomic unit — the C# source commits both via a single SaveChangesAsync;
	// two separate implicit transactions here could leave an asymmetric
	// friendship (one direction Accepted, the other missing) if interrupted
	// between them.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Friendship{}, fmt.Errorf("social: beginning accept-friend-request transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	pending, found, err := findPendingRequestForRecipient(ctx, tx, id, userID)
	if err != nil {
		return Friendship{}, err
	}
	if !found {
		return Friendship{}, ErrNotFound
	}

	accepted, err := acceptFriendship(ctx, tx, id)
	if err != nil {
		return Friendship{}, err
	}
	if _, err := insertFriendship(ctx, tx, userID, pending.UserID, FriendshipAccepted); err != nil {
		// A unique-violation here means the reverse row already exists — a
		// lost race against a concurrent accept, or a pre-existing
		// inconsistent row. Report a deterministic "this request is no
		// longer available to accept" (ErrNotFound, matching the 404 every
		// other AcceptFriendRequest failure produces) rather than
		// propagating the raw conflict — a deliberate divergence from the
		// C# source, which has no equivalent guard and would let an
		// unhandled DbUpdateException surface as a generic 500.
		if errors.Is(err, ErrConflict) {
			return Friendship{}, ErrNotFound
		}
		return Friendship{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Friendship{}, fmt.Errorf("social: committing accept-friend-request transaction: %w", err)
	}

	if err := events.Emit(ctx, s.registry, events.FriendRequestAccepted{UserID1: pending.UserID, UserID2: userID}); err != nil {
		s.logger.ErrorContext(ctx, "friend.request.accepted handler failed; acceptance already committed", "friendship_id", id, "error", err)
	}

	return accepted, nil
}

// DeclineFriendRequest deletes a Pending request, matching
// DeclineFriendRequest in FriendEndpoints.cs — only the recipient may
// decline; same ErrNotFound-for-everything-else rule as AcceptFriendRequest.
func (s *Service) DeclineFriendRequest(ctx context.Context, userID, id string) error {
	if !isValidUUID(id) {
		return ErrNotFound
	}
	pending, found, err := findPendingRequestForRecipient(ctx, s.pool, id, userID)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}
	return deleteFriendshipRow(ctx, s.pool, pending.ID)
}

// RemoveFriend deletes both directions of a friendship, matching
// RemoveFriend in FriendEndpoints.cs, and emits FriendRemoved.
func (s *Service) RemoveFriend(ctx context.Context, userID, friendID string) error {
	if !isValidUUID(friendID) {
		return ErrNotFound
	}
	// One statement, atomic by construction (deleteFriendshipBothDirections'
	// doc comment) — replaces a find-then-loop-delete that could leave a
	// partial removal if interrupted between individual row deletes.
	deleted, err := deleteFriendshipBothDirections(ctx, s.pool, userID, friendID)
	if err != nil {
		return err
	}
	if !deleted {
		return ErrNotFound
	}

	if err := events.Emit(ctx, s.registry, events.FriendRemoved{UserID1: userID, UserID2: friendID}); err != nil {
		s.logger.ErrorContext(ctx, "friend.removed handler failed; removal already committed", "user_id", userID, "friend_id", friendID, "error", err)
	}
	return nil
}

const (
	defaultPage     = 1
	defaultPageSize = 20
	maxPageSize     = 100
)

func clampPage(page int) int {
	if page < 1 {
		return defaultPage
	}
	return page
}

// clampPageSize mirrors ListFriends' `Math.Clamp(pageSize, 1, 100)` in
// FriendEndpoints.cs exactly: a pageSize below 1 clamps UP to 1 (not the
// default of 20 — Math.Clamp has no notion of "default," only min/max), and
// anything above 100 clamps down to 100.
func clampPageSize(pageSize int) int {
	switch {
	case pageSize < 1:
		return 1
	case pageSize > maxPageSize:
		return maxPageSize
	default:
		return pageSize
	}
}

// flameLevelRank orders FlameLevel wire strings for ListFriends' "best flame
// across visible habits" aggregation — matching FetchFlameMap's
// flameLevelRank dictionary in FriendEndpoints.cs exactly, including its
// "unknown levels rank above all known levels" fallback.
var flameLevelRank = map[string]int{
	"none": 0, "ember": 1, "steady": 2, "strong": 3, "blazing": 4,
}

func rankOf(level string) int {
	if r, ok := flameLevelRank[level]; ok {
		return r
	}
	return int(^uint(0) >> 1) // math.MaxInt, matching int.MaxValue's "ranks above everything"
}

// ListFriends returns userID's accepted friends, paginated, enriched with
// auth profile data and flame/consistency aggregated over each friend's
// habits visible to userID (a friend) — matching ListFriends in
// FriendEndpoints.cs, including its graceful degradation when profile or
// habit data can't be produced (a userID/habits-package error here still
// propagates as a real error; "unavailable" is reserved for a friend simply
// having no visible habits, not for a genuine failure — there is no
// cross-service network call left to fail gracefully around, unlike the old
// system's HTTP calls to auth-service/habit-service).
func (s *Service) ListFriends(ctx context.Context, userID string, page, pageSize int) (listFriendsResponse, error) {
	page = clampPage(page)
	pageSize = clampPageSize(pageSize)

	total, err := countAcceptedFriends(ctx, s.pool, userID)
	if err != nil {
		return listFriendsResponse{}, err
	}
	friends, err := listAcceptedFriends(ctx, s.pool, userID, page, pageSize)
	if err != nil {
		return listFriendsResponse{}, err
	}

	friendIDs := make([]string, len(friends))
	for i, f := range friends {
		friendIDs[i] = f.FriendID
	}
	profileByID := s.fetchProfileMap(ctx, friendIDs)

	items := make([]friendListItem, len(friends))
	for i, f := range friends {
		item := friendListItem{FriendID: f.FriendID, Since: f.CreatedAt, FlameLevel: "none"}
		if p, ok := profileByID[f.FriendID]; ok {
			username := p.Username
			item.Username = &username
			item.DisplayName = p.DisplayName
			item.AvatarURL = p.AvatarURL
		}

		flameLevel, consistency, unavailable, err := s.aggregateVisibleFlame(ctx, f.FriendID)
		if err != nil {
			return listFriendsResponse{}, err
		}
		item.FlameLevel = flameLevel
		item.Consistency = consistency
		item.HabitsUnavailable = unavailable

		items[i] = item
	}

	return listFriendsResponse{Items: items, Page: page, PageSize: pageSize, Total: total}, nil
}

// aggregateVisibleFlame computes ownerID's best flame level and average
// consistency across the habits visible to a friend viewer, matching
// FetchFlameMap in FriendEndpoints.cs. habitsUnavailable is true only when
// habits.Service itself errors — see ListFriends' doc comment for why that
// no longer models "service down" the way the old HTTP call's non-2xx
// responses did.
func (s *Service) aggregateVisibleFlame(ctx context.Context, ownerID string) (flameLevel string, consistency float64, unavailable bool, err error) {
	summaries, err := s.habits.HabitsForUser(ctx, ownerID)
	if err != nil {
		return "none", 0, true, nil //nolint:nilerr // matches the old system's graceful-degradation contract: a failure to read the friend's habits shows "none"/unavailable, not a 500 for the whole friend list.
	}
	if len(summaries) == 0 {
		return "none", 0, false, nil
	}

	visibility, defaultVisibility, err := s.visibilityContextFor(ctx, ownerID)
	if err != nil {
		return "", 0, false, err
	}

	bestFlame := "none"
	bestRank := 0
	var total float64
	var visibleCount int
	for _, hb := range summaries {
		v := effectiveVisibility(visibility[hb.ID], defaultVisibility)
		if !visibleToViewer(v, true) {
			continue
		}
		visibleCount++
		total += hb.Consistency
		if r := rankOf(hb.FlameLevel); r > bestRank {
			bestRank = r
			bestFlame = hb.FlameLevel
		}
	}
	if visibleCount == 0 {
		return "none", 0, false, nil
	}
	return bestFlame, math.Round(total/float64(visibleCount)*10) / 10, false, nil
}

// visibilityContextFor loads ownerID's explicit visibility settings and
// resolved default preference in one call — the pair every per-habit
// visibility decision (effectiveVisibility) needs.
func (s *Service) visibilityContextFor(ctx context.Context, ownerID string) (map[string]HabitVisibility, HabitVisibility, error) {
	settings, err := visibilityMapForUser(ctx, s.pool, ownerID)
	if err != nil {
		return nil, "", err
	}
	def, err := defaultVisibilityFor(ctx, s.pool, ownerID)
	if err != nil {
		return nil, "", err
	}
	return settings, def, nil
}

// fetchProfileMap resolves ids to a userID->ProfileSummary map via
// auth.BatchProfiles, degrading to an empty (non-nil) map — never an error —
// when the call fails: matches FetchProfileMap's try/catch in
// FriendEndpoints.cs, which treats a failed profile lookup as "no
// enrichment, still 200," never a failed request. The witness link viewer
// already applies this same degrade-not-fail rule to its own owner-profile
// lookup (witness_service.go's ViewWitnessLink) — ListFriends and
// ListFriendRequests previously diverged from it by propagating the error
// as a 500, which this fixes.
func (s *Service) fetchProfileMap(ctx context.Context, ids []string) map[string]auth.ProfileSummary {
	profiles, err := s.auth.BatchProfiles(ctx, ids)
	if err != nil {
		s.logger.WarnContext(ctx, "failed to fetch batch profiles from auth", "error", err)
		return map[string]auth.ProfileSummary{}
	}
	m := make(map[string]auth.ProfileSummary, len(profiles))
	for _, p := range profiles {
		m[p.UserID] = p
	}
	return m
}

// PendingRequestCount returns the number of incoming Pending requests for
// userID, matching GetPendingRequestCount in FriendEndpoints.cs.
func (s *Service) PendingRequestCount(ctx context.Context, userID string) (int, error) {
	return countPendingIncoming(ctx, s.pool, userID)
}

// ListFriendRequests returns userID's incoming and outgoing Pending
// requests, each enriched with the other party's auth profile, matching
// ListFriendRequests in FriendEndpoints.cs.
func (s *Service) ListFriendRequests(ctx context.Context, userID string) (listRequestsResponse, error) {
	incomingRaw, err := listPendingIncoming(ctx, s.pool, userID)
	if err != nil {
		return listRequestsResponse{}, err
	}
	outgoingRaw, err := listPendingOutgoing(ctx, s.pool, userID)
	if err != nil {
		return listRequestsResponse{}, err
	}

	// First-seen order (incoming then outgoing), not map iteration — matches
	// how a real userID slice built by concatenation would order duplicates,
	// so which ids survive BatchProfiles' 100-id cap (dedupeCap in
	// auth/service.go) is deterministic rather than depending on Go's
	// randomized map iteration order.
	seen := make(map[string]bool, len(incomingRaw)+len(outgoingRaw))
	allIDs := make([]string, 0, len(incomingRaw)+len(outgoingRaw))
	for _, f := range incomingRaw {
		if !seen[f.UserID] {
			seen[f.UserID] = true
			allIDs = append(allIDs, f.UserID)
		}
	}
	for _, f := range outgoingRaw {
		if !seen[f.FriendID] {
			seen[f.FriendID] = true
			allIDs = append(allIDs, f.FriendID)
		}
	}
	profileByID := s.fetchProfileMap(ctx, allIDs)

	incoming := make([]incomingRequestItem, len(incomingRaw))
	for i, f := range incomingRaw {
		item := incomingRequestItem{ID: f.ID, FromUserID: f.UserID, Direction: "incoming", CreatedAt: f.CreatedAt}
		if p, ok := profileByID[f.UserID]; ok {
			username := p.Username
			item.FromUsername = &username
			item.FromDisplayName = p.DisplayName
			item.FromAvatarURL = p.AvatarURL
		}
		incoming[i] = item
	}

	outgoing := make([]outgoingRequestItem, len(outgoingRaw))
	for i, f := range outgoingRaw {
		item := outgoingRequestItem{ID: f.ID, ToUserID: f.FriendID, Direction: "outgoing", CreatedAt: f.CreatedAt}
		if p, ok := profileByID[f.FriendID]; ok {
			username := p.Username
			item.ToUsername = &username
			item.ToDisplayName = p.DisplayName
			item.ToAvatarURL = p.AvatarURL
		}
		outgoing[i] = item
	}

	return listRequestsResponse{Incoming: incoming, Outgoing: outgoing}, nil
}

// FriendProfile returns friendID's visible habits for userID (a required
// Accepted friendship, else ErrNotFound), matching GetFriendProfile in
// FriendEndpoints.cs — habitsUnavailable mirrors ListFriends' degraded
// contract (see aggregateVisibleFlame's doc comment).
func (s *Service) FriendProfile(ctx context.Context, userID, friendID string) (friendProfileResponse, error) {
	if !isValidUUID(friendID) {
		return friendProfileResponse{}, ErrNotFound
	}
	isFriend, err := isAcceptedFriend(ctx, s.pool, userID, friendID)
	if err != nil {
		return friendProfileResponse{}, err
	}
	if !isFriend {
		return friendProfileResponse{}, ErrNotFound
	}

	summaries, err := s.habits.HabitsForUser(ctx, friendID)
	if err != nil {
		// FriendID is always present, even in the degraded response — the
		// C# source's GetFriendProfile builds `new { friendId, habits,
		// habitsUnavailable }` unconditionally, regardless of which branch
		// produced habits.
		return friendProfileResponse{FriendID: friendID, Habits: []friendProfileHabit{}, HabitsUnavailable: true}, nil //nolint:nilerr // graceful degradation, matching FriendProfile_HabitServiceError_ReturnsUnavailable.
	}

	visibility, defaultVisibility, err := s.visibilityContextFor(ctx, friendID)
	if err != nil {
		return friendProfileResponse{}, err
	}

	habitsOut := []friendProfileHabit{}
	for _, hb := range summaries {
		v := effectiveVisibility(visibility[hb.ID], defaultVisibility)
		if !visibleToViewer(v, true) {
			continue
		}
		habitsOut = append(habitsOut, friendProfileHabit{
			ID: hb.ID, Name: hb.Name, Icon: hb.Icon, Color: hb.Color,
			Consistency: hb.Consistency, FlameLevel: hb.FlameLevel,
		})
	}

	return friendProfileResponse{FriendID: friendID, Habits: habitsOut, HabitsUnavailable: false}, nil
}

// --- visibility & preferences ---

// SetHabitVisibility validates habitID's ownership via habits.Service.GetHabit
// (the in-process replacement for the old cross-service "does this user own
// this habit" HTTP check — see the doc comment on this method's ownership
// branch below for why the old 503-on-service-down test cases don't port),
// upserts the setting, and emits VisibilityChanged when the value actually
// changed, matching SetHabitVisibility in VisibilityEndpoints.cs.
func (s *Service) SetHabitVisibility(ctx context.Context, userID, habitID string, visibility HabitVisibility) (HabitVisibility, error) {
	if !isValidUUID(habitID) {
		return "", ErrNotFound
	}

	// Ownership check: GetHabit returns habits.ErrNotFound for a missing,
	// archived, or other-user-owned habit — exactly the "not found" case
	// SetHabitVisibility's cross-service check produced for a genuinely
	// unowned habit. Unlike the old system, this is now a direct in-process
	// call with no network hop to fail independently of the answer itself,
	// so there is no analogue of the old 503 ("Habit Service returned 5xx/
	// timed out") branch — a call that doesn't return "found" or "not found"
	// is a real internal error (mapped to 500), not a degraded 503. This is
	// the same architectural shift promise_public.go's Degraded-always-false
	// comment documents for the public flame surfaces.
	if _, err := s.habits.GetHabit(ctx, userID, habitID); err != nil {
		if errors.Is(err, habits.ErrNotFound) {
			return "", ErrNotFound
		}
		return "", err
	}

	existing, found, err := findVisibilitySetting(ctx, s.pool, userID, habitID)
	if err != nil {
		return "", err
	}
	oldVisibility := VisibilityPrivate
	if found {
		oldVisibility = existing.Visibility
	}

	if _, err := upsertVisibilitySetting(ctx, s.pool, userID, habitID, visibility, found); err != nil {
		return "", err
	}

	if oldVisibility != visibility {
		if err := events.Emit(ctx, s.registry, events.VisibilityChanged{
			UserID: userID, HabitID: habitID, Old: oldVisibility.String(), New: visibility.String(),
		}); err != nil {
			s.logger.ErrorContext(ctx, "visibility.changed handler failed; change already committed", "user_id", userID, "habit_id", habitID, "error", err)
		}
	}

	return visibility, nil
}

// Preferences returns userID's default habit visibility preference (Private
// if unset), matching GetPreferences in VisibilityEndpoints.cs.
func (s *Service) Preferences(ctx context.Context, userID string) (HabitVisibility, error) {
	return defaultVisibilityFor(ctx, s.pool, userID)
}

// UpdatePreferences upserts userID's default habit visibility preference,
// matching UpdatePreferences in VisibilityEndpoints.cs.
func (s *Service) UpdatePreferences(ctx context.Context, userID string, visibility HabitVisibility) (HabitVisibility, error) {
	_, found, err := findPreference(ctx, s.pool, userID)
	if err != nil {
		return "", err
	}
	pref, err := upsertPreference(ctx, s.pool, userID, visibility, found)
	if err != nil {
		return "", err
	}
	return pref.DefaultHabitVisibility, nil
}

// BatchVisibility returns userID's default preference plus every explicit
// per-habit visibility setting, matching GetBatchVisibility in
// VisibilityEndpoints.cs.
func (s *Service) BatchVisibility(ctx context.Context, userID string) (batchVisibilityResponse, error) {
	defaultVisibility, err := defaultVisibilityFor(ctx, s.pool, userID)
	if err != nil {
		return batchVisibilityResponse{}, err
	}
	settings, err := listVisibilitySettings(ctx, s.pool, userID)
	if err != nil {
		return batchVisibilityResponse{}, err
	}

	items := make([]batchVisibilityItem, len(settings))
	for i, v := range settings {
		items[i] = batchVisibilityItem{HabitID: v.HabitID, Visibility: v.Visibility.String()}
	}
	return batchVisibilityResponse{DefaultVisibility: defaultVisibility.String(), Habits: items}, nil
}

// effectiveVisibility resolves a specific habit's effective visibility: an
// explicit visibility_settings row (hasSetting) wins; if there is none, the
// owner's default preference applies — matching every visibility read in
// VisibilityEndpoints.cs/FriendEndpoints.cs (SetHabitVisibility's
// oldVisibility lookup, GetFriendProfile's per-habit filter, the
// cross-module visibility filter in crossmodule.go). setting is the zero
// value ("") when hasSetting is false — callers pass visibilityMapForUser's
// map lookup result directly (a missing key naturally zero-values to "").
func effectiveVisibility(setting HabitVisibility, def HabitVisibility) HabitVisibility {
	if setting != "" {
		return setting
	}
	return def
}

// visibleToViewer reports whether v is visible to a friend viewer (Friends
// or Public) or an anonymous/public viewer (Public only) — the shared rule
// GetFriendProfile, GetVisibleHabits, and the habits.PublicVisibilityFilter
// integration point (crossmodule.go) all apply.
func visibleToViewer(v HabitVisibility, isFriend bool) bool {
	if isFriend {
		return v == VisibilityFriends || v == VisibilityPublic
	}
	return v == VisibilityPublic
}
