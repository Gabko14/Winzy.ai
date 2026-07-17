package activity

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Gabko14/winzy/backend/internal/auth"
	"github.com/Gabko14/winzy/backend/internal/db"
	"github.com/Gabko14/winzy/backend/internal/events"
	"github.com/Gabko14/winzy/backend/internal/export"
	"github.com/Gabko14/winzy/backend/internal/social"
)

var habitEventTypes = map[string]bool{
	EventHabitCreated:   true,
	EventHabitCompleted: true,
}

// Service is the activity module's business logic.
type Service struct {
	pool     *pgxpool.Pool
	registry *events.Registry
	logger   *slog.Logger
	auth     *auth.Service
	social   *social.Service
}

// NewService wires a Service, registers all nine feed-event handlers, and
// registers the "activity" export section (C# literal).
func NewService(
	pool *pgxpool.Pool,
	registry *events.Registry,
	exportReg *export.Registry,
	authSvc *auth.Service,
	socialSvc *social.Service,
	logger *slog.Logger,
) *Service {
	s := &Service{
		pool: pool, registry: registry, logger: logger,
		auth: authSvc, social: socialSvc,
	}
	events.Register(registry, s.handleUserRegistered)
	events.Register(registry, s.handleHabitCreated)
	events.Register(registry, s.handleHabitCompleted)
	events.Register(registry, s.handleFriendRequestAccepted)
	events.Register(registry, s.handleChallengeCreated)
	events.Register(registry, s.handleChallengeCompleted)
	events.Register(registry, s.handleVisibilityChanged)
	events.Register(registry, s.handleFriendRemoved)
	events.Register(registry, s.handleUserDeleted)
	exportReg.Register("activity", s.exportSection)
	return s
}

// Feed returns a visibility-filtered, keyset-paginated page of feed
// entries for viewerID — port of GET /activity/feed in Program.cs.
func (s *Service) Feed(ctx context.Context, viewerID string, cursor *time.Time, limit int) (FeedPage, error) {
	friendIDs, err := s.social.FriendIDs(ctx, viewerID)
	if err != nil {
		s.logger.WarnContext(ctx, "friends list failed; showing self only",
			"user_id", viewerID, "error", err)
		friendIDs = nil
	}

	actorIDs := make([]string, 0, len(friendIDs)+1)
	actorIDs = append(actorIDs, viewerID)
	actorIDs = append(actorIDs, friendIDs...)

	// Per-(friend, habitID) verdict cache. true = visible, false = not
	// visible; absence means "not yet queried". Caching only the first
	// batch's habit ids (and skipping later lookups for that friend) would
	// hide genuinely visible habits that appear in later pagination
	// batches — C# avoided this by fetching the full default+exclusion set
	// up front; we merge incremental VisibleHabitIDsForViewer results.
	visibilityCache := make(map[string]map[string]bool, len(friendIDs))

	const maxIterations = 5
	batchSize := (limit + 1) * 2
	filtered := make([]FeedEntry, 0, limit+1)
	pageCursor := cursor
	exhausted := false

	for iter := 0; iter < maxIterations && len(filtered) <= limit && !exhausted; iter++ {
		raw, err := listFeedBatch(ctx, s.pool, actorIDs, pageCursor, batchSize)
		if err != nil {
			return FeedPage{}, err
		}
		if len(raw) < batchSize {
			exhausted = true
		}
		if len(raw) == 0 {
			break
		}
		pageCursorCopy := raw[len(raw)-1].CreatedAt
		pageCursor = &pageCursorCopy

		habitIDsByActor := map[string][]string{}
		for _, e := range raw {
			if e.ActorID == viewerID || !habitEventTypes[e.EventType] {
				continue
			}
			if hid, ok := habitIDFromData(e.Data); ok {
				habitIDsByActor[e.ActorID] = append(habitIDsByActor[e.ActorID], hid)
			}
		}
		for friendID, habitIDs := range habitIDsByActor {
			cache := visibilityCache[friendID]
			if cache == nil {
				cache = map[string]bool{}
				visibilityCache[friendID] = cache
			}
			var missing []string
			for _, hid := range dedupe(habitIDs) {
				if _, known := cache[hid]; !known {
					missing = append(missing, hid)
				}
			}
			if len(missing) == 0 {
				continue
			}
			visible, err := s.social.VisibleHabitIDsForViewer(ctx, friendID, missing, viewerID)
			if err != nil {
				s.logger.WarnContext(ctx, "visible habits lookup failed; excluding friend's habit events",
					"friend_id", friendID, "error", err)
				for _, hid := range missing {
					cache[hid] = false
				}
				continue
			}
			for _, hid := range missing {
				cache[hid] = visible[hid]
			}
		}

		for _, e := range raw {
			if e.ActorID == viewerID {
				filtered = append(filtered, e)
				continue
			}
			if !habitEventTypes[e.EventType] {
				filtered = append(filtered, e)
				continue
			}
			vis, ok := visibilityCache[e.ActorID]
			if !ok {
				continue
			}
			hid, ok := habitIDFromData(e.Data)
			if !ok {
				s.logger.WarnContext(ctx, "skipping feed entry with malformed data", "entry_id", e.ID)
				continue
			}
			if vis[hid] {
				filtered = append(filtered, e)
			}
		}
	}

	hasMore := len(filtered) > limit
	page := filtered
	if hasMore {
		page = filtered[:limit]
	}

	items := s.enrichWithProfiles(ctx, page)

	var nextCursor *string
	if hasMore && len(items) > 0 {
		c := items[len(items)-1].CreatedAt.UTC().Format(time.RFC3339Nano)
		nextCursor = &c
	}

	return FeedPage{Items: items, NextCursor: nextCursor, HasMore: hasMore}, nil
}

func (s *Service) enrichWithProfiles(ctx context.Context, entries []FeedEntry) []FeedEntryResponse {
	out := make([]FeedEntryResponse, len(entries))
	ids := make([]string, 0, len(entries))
	seen := map[string]bool{}
	for _, e := range entries {
		if !seen[e.ActorID] {
			seen[e.ActorID] = true
			ids = append(ids, e.ActorID)
		}
	}

	profiles := map[string]auth.ProfileSummary{}
	if len(ids) > 0 {
		batch, err := s.auth.BatchProfiles(ctx, ids)
		if err != nil {
			s.logger.WarnContext(ctx, "batch profiles failed", "error", err)
		} else {
			for _, p := range batch {
				profiles[p.UserID] = p
			}
		}
	}

	for i, e := range entries {
		var username *string
		var displayName *string
		var avatarURL *string
		if p, ok := profiles[e.ActorID]; ok {
			u := p.Username
			username = &u
			displayName = p.DisplayName
			avatarURL = p.AvatarURL
		}
		data := e.Data
		if data == nil {
			data = json.RawMessage("null")
		}
		out[i] = FeedEntryResponse{
			ID: e.ID, ActorID: e.ActorID,
			ActorUsername: username, ActorDisplayName: displayName,
			ActorAvatarURL: avatarURL,
			EventType:      e.EventType, Data: data, CreatedAt: e.CreatedAt,
		}
	}
	return out
}

func (s *Service) handleUserRegistered(ctx context.Context, event events.UserRegistered) error {
	q := db.QuerierFrom(ctx, s.pool)
	key := "user.registered:" + event.UserID
	data, err := json.Marshal(map[string]string{
		"userId": event.UserID, "username": event.Username,
	})
	if err != nil {
		return fmt.Errorf("activity: marshaling user.registered data: %w", err)
	}
	entry, inserted, err := insertFeedEntry(ctx, q, event.UserID, EventUserRegistered, data, key)
	if err != nil {
		return err
	}
	if inserted {
		s.logger.InfoContext(ctx, "created feed entry for user.registered",
			"entry_id", entry.ID, "actor_id", event.UserID)
	} else {
		s.logger.InfoContext(ctx, "duplicate user.registered skipped", "key", key)
	}
	return nil
}

func (s *Service) handleHabitCreated(ctx context.Context, event events.HabitCreated) error {
	q := db.QuerierFrom(ctx, s.pool)
	key := fmt.Sprintf("habit.created:%s:%s", event.UserID, event.HabitID)
	data, err := json.Marshal(map[string]string{
		"userId": event.UserID, "habitId": event.HabitID, "name": event.Name,
	})
	if err != nil {
		return fmt.Errorf("activity: marshaling habit.created data: %w", err)
	}
	entry, inserted, err := insertFeedEntry(ctx, q, event.UserID, EventHabitCreated, data, key)
	if err != nil {
		return err
	}
	if inserted {
		s.logger.InfoContext(ctx, "created feed entry for habit.created",
			"entry_id", entry.ID, "actor_id", event.UserID, "habit_id", event.HabitID)
	} else {
		s.logger.InfoContext(ctx, "duplicate habit.created skipped", "key", key)
	}
	return nil
}

func (s *Service) handleHabitCompleted(ctx context.Context, event events.HabitCompleted) error {
	q := db.QuerierFrom(ctx, s.pool)
	dateStr := event.Date.UTC().Format("2006-01-02")
	key := fmt.Sprintf("habit.completed:%s:%s:%s", event.UserID, event.HabitID, dateStr)
	data, err := json.Marshal(map[string]any{
		"userId": event.UserID, "habitId": event.HabitID,
		"date": event.Date.UTC(), "consistency": event.Consistency,
	})
	if err != nil {
		return fmt.Errorf("activity: marshaling habit.completed data: %w", err)
	}
	entry, inserted, err := insertFeedEntry(ctx, q, event.UserID, EventHabitCompleted, data, key)
	if err != nil {
		return err
	}
	if inserted {
		s.logger.InfoContext(ctx, "created feed entry for habit.completed",
			"entry_id", entry.ID, "actor_id", event.UserID, "habit_id", event.HabitID)
	} else {
		s.logger.InfoContext(ctx, "duplicate habit.completed skipped", "key", key)
	}
	return nil
}

func (s *Service) handleFriendRequestAccepted(ctx context.Context, event events.FriendRequestAccepted) error {
	// FriendRequestAccepted is emitted post-commit by social, so the ctx
	// querier is normally the pool. Both feed entries must land atomically
	// (C# SaveChanges wrote them in one tx) — otherwise a crash between
	// inserts leaves entry1 without entry2, and replay early-returns on the
	// key1 duplicate forever. When a caller already put a tx in ctx, join it.
	q := db.QuerierFrom(ctx, s.pool)
	if _, isPool := q.(*pgxpool.Pool); isPool {
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("activity: beginning friend.request.accepted transaction: %w", err)
		}
		defer tx.Rollback(ctx)
		if err := s.insertFriendAcceptedPair(ctx, tx, event); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("activity: committing friend.request.accepted: %w", err)
		}
		return nil
	}
	return s.insertFriendAcceptedPair(ctx, q, event)
}

func (s *Service) insertFriendAcceptedPair(ctx context.Context, q db.Querier, event events.FriendRequestAccepted) error {
	pairKey := friendshipPairKey(event.UserID1, event.UserID2)
	key1 := "friend.request.accepted:" + pairKey + ":1"
	key2 := "friend.request.accepted:" + pairKey + ":2"

	payload, err := json.Marshal(map[string]string{
		"userId1": event.UserID1, "userId2": event.UserID2,
	})
	if err != nil {
		return fmt.Errorf("activity: marshaling friend.request.accepted data: %w", err)
	}

	entry1, inserted1, err := insertFeedEntry(ctx, q, event.UserID1, EventFriendRequestAccepted, payload, key1)
	if err != nil {
		return err
	}
	if !inserted1 {
		// Deliberate divergence from C# FriendRequestAcceptedSubscriber,
		// which skips BOTH entries on a key1 hit. That leaves a permanent
		// hole if a pre-tx crash wrote only entry1; we still attempt key2
		// so replay heals the orphan. Idempotent when both already exist.
		s.logger.InfoContext(ctx, "duplicate friend.request.accepted key1; ensuring key2",
			"key", key1)
		entry2, inserted2, err := insertFeedEntry(ctx, q, event.UserID2, EventFriendRequestAccepted, payload, key2)
		if err != nil {
			return err
		}
		if inserted2 {
			s.logger.InfoContext(ctx, "healed missing friend.request.accepted key2",
				"entry_id_2", entry2.ID, "key", key2)
		}
		return nil
	}

	entry2, inserted2, err := insertFeedEntry(ctx, q, event.UserID2, EventFriendRequestAccepted, payload, key2)
	if err != nil {
		return err
	}
	if !inserted2 {
		// key1 wrote in this tx but key2 conflicted — abort so the caller's
		// tx (or our own) rolls back entry1 instead of committing an orphan.
		return fmt.Errorf("activity: friend.request.accepted incomplete pair (key2 conflict after key1 insert)")
	}
	s.logger.InfoContext(ctx, "created feed entries for friend.request.accepted",
		"entry_id_1", entry1.ID, "entry_id_2", entry2.ID)
	return nil
}

func (s *Service) handleChallengeCreated(ctx context.Context, event events.ChallengeCreated) error {
	q := db.QuerierFrom(ctx, s.pool)
	key := "challenge.created:" + event.ChallengeID
	data, err := json.Marshal(map[string]string{
		"challengeId": event.ChallengeID,
		"fromUserId":  event.From,
		"toUserId":    event.To,
		"habitId":     event.HabitID,
	})
	if err != nil {
		return fmt.Errorf("activity: marshaling challenge.created data: %w", err)
	}
	entry, inserted, err := insertFeedEntry(ctx, q, event.From, EventChallengeCreated, data, key)
	if err != nil {
		return err
	}
	if inserted {
		s.logger.InfoContext(ctx, "created feed entry for challenge.created",
			"entry_id", entry.ID, "challenge_id", event.ChallengeID)
	} else {
		s.logger.InfoContext(ctx, "duplicate challenge.created skipped", "key", key)
	}
	return nil
}

func (s *Service) handleChallengeCompleted(ctx context.Context, event events.ChallengeCompleted) error {
	q := db.QuerierFrom(ctx, s.pool)
	key := "challenge.completed:" + event.ChallengeID
	data, err := json.Marshal(map[string]string{
		"challengeId": event.ChallengeID,
		"userId":      event.UserID,
		"reward":      event.Reward,
	})
	if err != nil {
		return fmt.Errorf("activity: marshaling challenge.completed data: %w", err)
	}
	entry, inserted, err := insertFeedEntry(ctx, q, event.UserID, EventChallengeCompleted, data, key)
	if err != nil {
		return err
	}
	if inserted {
		s.logger.InfoContext(ctx, "created feed entry for challenge.completed",
			"entry_id", entry.ID, "challenge_id", event.ChallengeID)
	} else {
		s.logger.InfoContext(ctx, "duplicate challenge.completed skipped", "key", key)
	}
	return nil
}

func (s *Service) handleVisibilityChanged(ctx context.Context, event events.VisibilityChanged) error {
	q := db.QuerierFrom(ctx, s.pool)
	if isNarrowing(event.Old, event.New) {
		n, err := softDeleteHabitEntries(ctx, q, event.UserID, event.HabitID)
		if err != nil {
			return err
		}
		s.logger.InfoContext(ctx, "soft-deleted feed entries after visibility narrowing",
			"count", n, "user_id", event.UserID, "habit_id", event.HabitID,
			"old", event.Old, "new", event.New)
		return nil
	}
	if isWidening(event.Old, event.New) {
		n, err := restoreHabitEntries(ctx, q, event.UserID, event.HabitID)
		if err != nil {
			return err
		}
		s.logger.InfoContext(ctx, "restored feed entries after visibility widening",
			"count", n, "user_id", event.UserID, "habit_id", event.HabitID,
			"old", event.Old, "new", event.New)
		return nil
	}
	s.logger.InfoContext(ctx, "visibility unchanged; skipping",
		"old", event.Old, "new", event.New)
	return nil
}

func (s *Service) handleFriendRemoved(ctx context.Context, event events.FriendRemoved) error {
	q := db.QuerierFrom(ctx, s.pool)
	n, err := softDeleteFriendAcceptedEntries(ctx, q, event.UserID1, event.UserID2)
	if err != nil {
		return err
	}
	s.logger.InfoContext(ctx, "soft-deleted friendship feed entries after friend.removed",
		"count", n, "user_id_1", event.UserID1, "user_id_2", event.UserID2)
	return nil
}

func (s *Service) handleUserDeleted(ctx context.Context, event events.UserDeleted) error {
	q := db.QuerierFrom(ctx, s.pool)
	actorDeleted, err := hardDeleteActorEntries(ctx, q, event.UserID)
	if err != nil {
		return err
	}
	refDeleted, err := hardDeleteReferencingEntries(ctx, q, event.UserID)
	if err != nil {
		return err
	}
	s.logger.InfoContext(ctx, "hard-deleted feed entries for user.deleted",
		"actor_count", actorDeleted, "ref_count", refDeleted, "user_id", event.UserID)
	return nil
}

func friendshipPairKey(a, b string) string {
	if strings.Compare(a, b) < 0 {
		return a + ":" + b
	}
	return b + ":" + a
}

func visibilityRank(v string) int {
	switch strings.ToLower(v) {
	case "public":
		return 3
	case "friends":
		return 2
	case "private":
		return 1
	default:
		return 0
	}
}

func isNarrowing(oldVis, newVis string) bool {
	return visibilityRank(newVis) < visibilityRank(oldVis)
}

func isWidening(oldVis, newVis string) bool {
	return visibilityRank(newVis) > visibilityRank(oldVis)
}

func habitIDFromData(data json.RawMessage) (string, bool) {
	if len(data) == 0 {
		return "", false
	}
	var payload struct {
		HabitID string `json:"habitId"`
	}
	if err := json.Unmarshal(data, &payload); err != nil || payload.HabitID == "" {
		return "", false
	}
	return payload.HabitID, true
}

func dedupe(ids []string) []string {
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}
