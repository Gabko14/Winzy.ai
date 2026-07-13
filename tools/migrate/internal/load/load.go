// Package load truncates the rehearsal target and copies transformed rows
// from the six winzy_mig_src_* databases (winzy.ai-rdc7.9).
package load

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"winzy.ai/migrate/internal/config"
	"winzy.ai/migrate/internal/enums"
)

// Result captures per-table load stats and any orphan findings.
type Result struct {
	Inserted map[string]int
	Orphans  []Orphan
}

type Orphan struct {
	Table      string
	Column     string
	Value      string
	Referenced string
	RowID      string
}

// Run truncates target application tables then loads parents-first.
// Orphans are collected and returned; callers must fail the run if any exist.
func Run(ctx context.Context, cfg config.Config) (*Result, error) {
	if err := cfg.ValidateTarget(); err != nil {
		return nil, err
	}
	target, err := pgxpool.New(ctx, cfg.TargetURL())
	if err != nil {
		return nil, fmt.Errorf("load: target pool: %w", err)
	}
	defer target.Close()

	sources := map[string]*pgxpool.Pool{}
	defer func() {
		for _, p := range sources {
			p.Close()
		}
	}()
	for _, svc := range config.SourceServices {
		p, err := pgxpool.New(ctx, cfg.SourceURL(svc.DB))
		if err != nil {
			return nil, fmt.Errorf("load: source pool %s: %w", svc.DB, err)
		}
		sources[svc.Name] = p
	}

	if err := truncateTarget(ctx, target); err != nil {
		return nil, err
	}

	res := &Result{Inserted: map[string]int{}}

	n, err := copyUsers(ctx, sources["auth"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["users"] = n

	n, err = copyHabits(ctx, sources["habit"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["habits"] = n

	n, orphans, err := copyCompletions(ctx, sources["habit"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["completions"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copyPromises(ctx, sources["habit"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["promises"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copyFriendships(ctx, sources["social"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["friendships"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copySocialPreferences(ctx, sources["social"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["social_preferences"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copyVisibilitySettings(ctx, sources["social"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["visibility_settings"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copyWitnessLinks(ctx, sources["social"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["witness_links"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copyWitnessLinkHabits(ctx, sources["social"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["witness_link_habits"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copyChallenges(ctx, sources["challenge"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["challenges"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copyNotifications(ctx, sources["notification"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["notifications"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copyNotificationSettings(ctx, sources["notification"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["notification_settings"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copyDeviceTokens(ctx, sources["notification"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["device_tokens"] = n
	res.Orphans = append(res.Orphans, orphans...)

	n, orphans, err = copyFeedEntries(ctx, sources["activity"], target)
	if err != nil {
		return nil, err
	}
	res.Inserted["feed_entries"] = n
	res.Orphans = append(res.Orphans, orphans...)

	// Soft logical FK checks that INSERT FKs do not cover (cross-module user_id).
	more, err := checkLogicalOrphans(ctx, target)
	if err != nil {
		return nil, err
	}
	res.Orphans = append(res.Orphans, more...)

	fmt.Fprintf(os.Stderr, "load: inserted %d tables; orphans=%d\n", len(res.Inserted), len(res.Orphans))
	return res, nil
}

func truncateTarget(ctx context.Context, target *pgxpool.Pool) error {
	// Children first. refresh_tokens is schema-created but never loaded — truncate too.
	_, err := target.Exec(ctx, `
		TRUNCATE TABLE
			feed_entries,
			device_tokens,
			notification_settings,
			notifications,
			challenges,
			witness_link_habits,
			witness_links,
			visibility_settings,
			social_preferences,
			friendships,
			promises,
			completions,
			habits,
			refresh_tokens,
			users
		RESTART IDENTITY CASCADE`)
	if err != nil {
		return fmt.Errorf("load: truncate: %w", err)
	}
	return nil
}

func existsUUID(ctx context.Context, db *pgxpool.Pool, query, id string) (bool, error) {
	var one int
	err := db.QueryRow(ctx, query, id).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func copyUsers(ctx context.Context, src, dst *pgxpool.Pool) (int, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, email, username, password_hash,
		       display_name, avatar_url, last_login_at
		FROM users`)
	if err != nil {
		return 0, fmt.Errorf("load: users select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, email, username, passwordHash string
			displayName, avatarURL            *string
			createdAt, updatedAt              time.Time
			lastLoginAt                       *time.Time
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &email, &username, &passwordHash,
			&displayName, &avatarURL, &lastLoginAt); err != nil {
			return n, fmt.Errorf("load: users scan: %w", err)
		}
		_, err := dst.Exec(ctx, `
			INSERT INTO users (id, created_at, updated_at, email, username, password_hash,
			                   display_name, avatar_url, last_login_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			id, createdAt, updatedAt, email, username, passwordHash,
			displayName, avatarURL, lastLoginAt)
		if err != nil {
			return n, fmt.Errorf("load: users insert %s: %w", id, err)
		}
		n++
	}
	return n, rows.Err()
}

func copyHabits(ctx context.Context, src, dst *pgxpool.Pool) (int, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, user_id, name, icon, color, frequency,
		       custom_days, minimum_description, archived_at
		FROM habits`)
	if err != nil {
		return 0, fmt.Errorf("load: habits select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, userID, name, frequency string
			icon, color, minDesc        *string
			customDays                  []byte
			createdAt, updatedAt        time.Time
			archivedAt                  *time.Time
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &userID, &name, &icon, &color, &frequency,
			&customDays, &minDesc, &archivedAt); err != nil {
			return n, fmt.Errorf("load: habits scan: %w", err)
		}
		freq, err := enums.Map(enums.HabitsFrequency, frequency)
		if err != nil {
			return n, err
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO habits (id, created_at, updated_at, user_id, name, icon, color, frequency,
			                    custom_days, minimum_description, archived_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			id, createdAt, updatedAt, userID, name, icon, color, freq,
			jsonbOrNil(customDays), minDesc, archivedAt)
		if err != nil {
			return n, fmt.Errorf("load: habits insert %s: %w", id, err)
		}
		n++
	}
	return n, rows.Err()
}

func copyCompletions(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, habit_id, user_id, completed_at,
		       local_date, completion_kind, note
		FROM completions`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: completions select: %w", err)
	}
	defer rows.Close()

	var orphans []Orphan
	n := 0
	for rows.Next() {
		var (
			id, habitID, userID, kind string
			note                      *string
			createdAt, updatedAt      time.Time
			completedAt               time.Time
			localDate                 time.Time
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &habitID, &userID, &completedAt,
			&localDate, &kind, &note); err != nil {
			return n, orphans, fmt.Errorf("load: completions scan: %w", err)
		}
		mapped, err := enums.Map(enums.CompletionsCompletionKind, kind)
		if err != nil {
			return n, orphans, err
		}
		ok, err := existsUUID(ctx, dst, `SELECT 1 FROM habits WHERE id = $1::uuid`, habitID)
		if err != nil {
			return n, orphans, err
		}
		if !ok {
			orphans = append(orphans, Orphan{Table: "completions", Column: "habit_id", Value: habitID, Referenced: "habits.id", RowID: id})
			continue // report, do not drop silently — skip insert that would violate FK
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO completions (id, created_at, updated_at, habit_id, user_id, completed_at,
			                         local_date, completion_kind, note)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			id, createdAt, updatedAt, habitID, userID, completedAt, localDate, mapped, note)
		if err != nil {
			return n, orphans, fmt.Errorf("load: completions insert %s: %w", id, err)
		}
		n++
	}
	return n, orphans, rows.Err()
}

func copyPromises(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, user_id, habit_id, target_consistency,
		       end_date, private_note, status, is_public_on_flame, resolved_at
		FROM promises`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: promises select: %w", err)
	}
	defer rows.Close()

	var orphans []Orphan
	n := 0
	for rows.Next() {
		var (
			id, userID, habitID, status string
			privateNote                 *string
			target                      float64
			endDate                     time.Time
			createdAt, updatedAt        time.Time
			resolvedAt                  *time.Time
			isPublic                    bool
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &userID, &habitID, &target,
			&endDate, &privateNote, &status, &isPublic, &resolvedAt); err != nil {
			return n, orphans, fmt.Errorf("load: promises scan: %w", err)
		}
		mapped, err := enums.Map(enums.PromisesStatus, status)
		if err != nil {
			return n, orphans, err
		}
		ok, err := existsUUID(ctx, dst, `SELECT 1 FROM habits WHERE id = $1::uuid`, habitID)
		if err != nil {
			return n, orphans, err
		}
		if !ok {
			orphans = append(orphans, Orphan{Table: "promises", Column: "habit_id", Value: habitID, Referenced: "habits.id", RowID: id})
			continue
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO promises (id, created_at, updated_at, user_id, habit_id, target_consistency,
			                      end_date, private_note, status, is_public_on_flame, resolved_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			id, createdAt, updatedAt, userID, habitID, target, endDate, privateNote, mapped, isPublic, resolvedAt)
		if err != nil {
			return n, orphans, fmt.Errorf("load: promises insert %s: %w", id, err)
		}
		n++
	}
	return n, orphans, rows.Err()
}

func copyFriendships(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, user_id, friend_id, status FROM friendships`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: friendships select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, userID, friendID, status string
			createdAt, updatedAt         time.Time
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &userID, &friendID, &status); err != nil {
			return n, nil, fmt.Errorf("load: friendships scan: %w", err)
		}
		mapped, err := enums.Map(enums.FriendshipsStatus, status)
		if err != nil {
			return n, nil, err
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO friendships (id, created_at, updated_at, user_id, friend_id, status)
			VALUES ($1,$2,$3,$4,$5,$6)`,
			id, createdAt, updatedAt, userID, friendID, mapped)
		if err != nil {
			return n, nil, fmt.Errorf("load: friendships insert %s: %w", id, err)
		}
		n++
	}
	return n, nil, rows.Err()
}

func copySocialPreferences(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, user_id, default_habit_visibility FROM social_preferences`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: social_preferences select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, userID, vis      string
			createdAt, updatedAt time.Time
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &userID, &vis); err != nil {
			return n, nil, fmt.Errorf("load: social_preferences scan: %w", err)
		}
		mapped, err := enums.Map(enums.SocialPreferencesDefaultHabitVisibility, vis)
		if err != nil {
			return n, nil, err
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO social_preferences (id, created_at, updated_at, user_id, default_habit_visibility)
			VALUES ($1,$2,$3,$4,$5)`,
			id, createdAt, updatedAt, userID, mapped)
		if err != nil {
			return n, nil, fmt.Errorf("load: social_preferences insert %s: %w", id, err)
		}
		n++
	}
	return n, nil, rows.Err()
}

func copyVisibilitySettings(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, user_id, habit_id, visibility FROM visibility_settings`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: visibility_settings select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, userID, habitID, vis string
			createdAt, updatedAt     time.Time
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &userID, &habitID, &vis); err != nil {
			return n, nil, fmt.Errorf("load: visibility_settings scan: %w", err)
		}
		mapped, err := enums.Map(enums.VisibilitySettingsVisibility, vis)
		if err != nil {
			return n, nil, err
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO visibility_settings (id, created_at, updated_at, user_id, habit_id, visibility)
			VALUES ($1,$2,$3,$4,$5,$6)`,
			id, createdAt, updatedAt, userID, habitID, mapped)
		if err != nil {
			return n, nil, fmt.Errorf("load: visibility_settings insert %s: %w", id, err)
		}
		n++
	}
	return n, nil, rows.Err()
}

func copyWitnessLinks(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, owner_id, token, label, revoked_at FROM witness_links`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: witness_links select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, ownerID, token   string
			label                *string
			createdAt, updatedAt time.Time
			revokedAt            *time.Time
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &ownerID, &token, &label, &revokedAt); err != nil {
			return n, nil, fmt.Errorf("load: witness_links scan: %w", err)
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO witness_links (id, created_at, updated_at, owner_id, token, label, revoked_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			id, createdAt, updatedAt, ownerID, token, label, revokedAt)
		if err != nil {
			return n, nil, fmt.Errorf("load: witness_links insert %s: %w", id, err)
		}
		n++
	}
	return n, nil, rows.Err()
}

func copyWitnessLinkHabits(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `SELECT witness_link_id, habit_id FROM witness_link_habits`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: witness_link_habits select: %w", err)
	}
	defer rows.Close()

	var orphans []Orphan
	n := 0
	for rows.Next() {
		var linkID, habitID string
		if err := rows.Scan(&linkID, &habitID); err != nil {
			return n, orphans, fmt.Errorf("load: witness_link_habits scan: %w", err)
		}
		ok, err := existsUUID(ctx, dst, `SELECT 1 FROM witness_links WHERE id = $1::uuid`, linkID)
		if err != nil {
			return n, orphans, err
		}
		if !ok {
			orphans = append(orphans, Orphan{Table: "witness_link_habits", Column: "witness_link_id", Value: linkID, Referenced: "witness_links.id", RowID: linkID + "/" + habitID})
			continue
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO witness_link_habits (witness_link_id, habit_id) VALUES ($1,$2)`,
			linkID, habitID)
		if err != nil {
			return n, orphans, fmt.Errorf("load: witness_link_habits insert: %w", err)
		}
		n++
	}
	return n, orphans, rows.Err()
}

func copyChallenges(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, habit_id, creator_id, recipient_id, milestone_type,
		       target_value, period_days, reward_description, status, current_progress, ends_at,
		       completed_at, claimed_at, completion_count, processed_completion_dates,
		       custom_start_date, custom_end_date, baseline_consistency
		FROM challenges`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: challenges select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, habitID, creatorID, recipientID, milestone, status, reward string
			target, progress                                               float64
			periodDays, completionCount                                    int
			processed                                                      []byte
			baseline                                                       *float64
			createdAt, updatedAt, endsAt                                   time.Time
			completedAt, claimedAt, customStart, customEnd                 *time.Time
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &habitID, &creatorID, &recipientID, &milestone,
			&target, &periodDays, &reward, &status, &progress, &endsAt,
			&completedAt, &claimedAt, &completionCount, &processed,
			&customStart, &customEnd, &baseline); err != nil {
			return n, nil, fmt.Errorf("load: challenges scan: %w", err)
		}
		ms, err := enums.Map(enums.ChallengesMilestoneType, milestone)
		if err != nil {
			return n, nil, err
		}
		st, err := enums.Map(enums.ChallengesStatus, status)
		if err != nil {
			return n, nil, err
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO challenges (
				id, created_at, updated_at, habit_id, creator_id, recipient_id, milestone_type,
				target_value, period_days, reward_description, status, current_progress, ends_at,
				completed_at, claimed_at, completion_count, processed_completion_dates,
				custom_start_date, custom_end_date, baseline_consistency
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
			id, createdAt, updatedAt, habitID, creatorID, recipientID, ms,
			target, periodDays, reward, st, progress, endsAt,
			completedAt, claimedAt, completionCount, jsonbOrNil(processed),
			customStart, customEnd, baseline)
		if err != nil {
			return n, nil, fmt.Errorf("load: challenges insert %s: %w", id, err)
		}
		n++
	}
	return n, nil, rows.Err()
}

func copyNotifications(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, user_id, type, data, read_at,
		       idempotency_key, push_delivered
		FROM notifications`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: notifications select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, userID, typ      string
			data                 []byte
			idempotencyKey       *string
			createdAt, updatedAt time.Time
			readAt               *time.Time
			pushDelivered        bool
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &userID, &typ, &data, &readAt,
			&idempotencyKey, &pushDelivered); err != nil {
			return n, nil, fmt.Errorf("load: notifications scan: %w", err)
		}
		mapped, err := enums.Map(enums.NotificationsType, typ)
		if err != nil {
			return n, nil, err
		}
		if data == nil {
			data = []byte("{}")
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO notifications (id, created_at, updated_at, user_id, type, data, read_at,
			                           idempotency_key, push_delivered)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			id, createdAt, updatedAt, userID, mapped, data, readAt, idempotencyKey, pushDelivered)
		if err != nil {
			return n, nil, fmt.Errorf("load: notifications insert %s: %w", id, err)
		}
		n++
	}
	return n, nil, rows.Err()
}

func copyNotificationSettings(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, user_id, habit_reminders, friend_activity, challenge_updates
		FROM notification_settings`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: notification_settings select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, userID                     string
			createdAt, updatedAt           time.Time
			habitReminders, friendActivity bool
			challengeUpdates               bool
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &userID, &habitReminders, &friendActivity, &challengeUpdates); err != nil {
			return n, nil, fmt.Errorf("load: notification_settings scan: %w", err)
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO notification_settings (id, created_at, updated_at, user_id, habit_reminders, friend_activity, challenge_updates)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			id, createdAt, updatedAt, userID, habitReminders, friendActivity, challengeUpdates)
		if err != nil {
			return n, nil, fmt.Errorf("load: notification_settings insert %s: %w", id, err)
		}
		n++
	}
	return n, nil, rows.Err()
}

func copyDeviceTokens(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, user_id, platform, token, device_id FROM device_tokens`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: device_tokens select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, userID, platform, token string
			deviceID                    *string
			createdAt, updatedAt        time.Time
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &userID, &platform, &token, &deviceID); err != nil {
			return n, nil, fmt.Errorf("load: device_tokens scan: %w", err)
		}
		mapped, err := enums.Map(enums.DeviceTokensPlatform, platform)
		if err != nil {
			return n, nil, err
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO device_tokens (id, created_at, updated_at, user_id, platform, token, device_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			id, createdAt, updatedAt, userID, mapped, token, deviceID)
		if err != nil {
			return n, nil, fmt.Errorf("load: device_tokens insert %s: %w", id, err)
		}
		n++
	}
	return n, nil, rows.Err()
}

func copyFeedEntries(ctx context.Context, src, dst *pgxpool.Pool) (int, []Orphan, error) {
	// Intentionally omit actor_display_name / actor_username (dropped in Go schema).
	rows, err := src.Query(ctx, `
		SELECT id, created_at, updated_at, actor_id, event_type, data, idempotency_key, deleted_at
		FROM feed_entries`)
	if err != nil {
		return 0, nil, fmt.Errorf("load: feed_entries select: %w", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var (
			id, actorID, eventType string
			data                   []byte
			idempotencyKey         *string
			createdAt, updatedAt   time.Time
			deletedAt              *time.Time
		)
		if err := rows.Scan(&id, &createdAt, &updatedAt, &actorID, &eventType, &data, &idempotencyKey, &deletedAt); err != nil {
			return n, nil, fmt.Errorf("load: feed_entries scan: %w", err)
		}
		_, err = dst.Exec(ctx, `
			INSERT INTO feed_entries (id, created_at, updated_at, actor_id, event_type, data, idempotency_key, deleted_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			id, createdAt, updatedAt, actorID, eventType, jsonbOrNil(data), idempotencyKey, deletedAt)
		if err != nil {
			return n, nil, fmt.Errorf("load: feed_entries insert %s: %w", id, err)
		}
		n++
	}
	return n, nil, rows.Err()
}

func checkLogicalOrphans(ctx context.Context, target *pgxpool.Pool) ([]Orphan, error) {
	type check struct {
		table, column, ref, sql string
	}
	checks := []check{
		{"habits", "user_id", "users.id", `SELECT id::text, user_id::text FROM habits h WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = h.user_id)`},
		{"completions", "user_id", "users.id", `SELECT id::text, user_id::text FROM completions c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)`},
		{"promises", "user_id", "users.id", `SELECT id::text, user_id::text FROM promises p WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.user_id)`},
		{"friendships", "user_id", "users.id", `SELECT id::text, user_id::text FROM friendships f WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f.user_id)`},
		{"friendships", "friend_id", "users.id", `SELECT id::text, friend_id::text FROM friendships f WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f.friend_id)`},
		{"social_preferences", "user_id", "users.id", `SELECT id::text, user_id::text FROM social_preferences s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)`},
		{"visibility_settings", "user_id", "users.id", `SELECT id::text, user_id::text FROM visibility_settings v WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v.user_id)`},
		{"visibility_settings", "habit_id", "habits.id", `SELECT id::text, habit_id::text FROM visibility_settings v WHERE NOT EXISTS (SELECT 1 FROM habits h WHERE h.id = v.habit_id)`},
		{"witness_links", "owner_id", "users.id", `SELECT id::text, owner_id::text FROM witness_links w WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = w.owner_id)`},
		{"witness_link_habits", "habit_id", "habits.id", `SELECT (witness_link_id::text || '/' || habit_id::text), habit_id::text FROM witness_link_habits w WHERE NOT EXISTS (SELECT 1 FROM habits h WHERE h.id = w.habit_id)`},
		{"challenges", "habit_id", "habits.id", `SELECT id::text, habit_id::text FROM challenges c WHERE NOT EXISTS (SELECT 1 FROM habits h WHERE h.id = c.habit_id)`},
		{"challenges", "creator_id", "users.id", `SELECT id::text, creator_id::text FROM challenges c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.creator_id)`},
		{"challenges", "recipient_id", "users.id", `SELECT id::text, recipient_id::text FROM challenges c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.recipient_id)`},
		{"notifications", "user_id", "users.id", `SELECT id::text, user_id::text FROM notifications n WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id)`},
		{"notification_settings", "user_id", "users.id", `SELECT id::text, user_id::text FROM notification_settings n WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id)`},
		{"device_tokens", "user_id", "users.id", `SELECT id::text, user_id::text FROM device_tokens d WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = d.user_id)`},
		{"feed_entries", "actor_id", "users.id", `SELECT id::text, actor_id::text FROM feed_entries f WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f.actor_id)`},
	}
	var out []Orphan
	for _, c := range checks {
		rows, err := target.Query(ctx, c.sql)
		if err != nil {
			return nil, fmt.Errorf("load: orphan check %s.%s: %w", c.table, c.column, err)
		}
		for rows.Next() {
			var rowID, val string
			if err := rows.Scan(&rowID, &val); err != nil {
				rows.Close()
				return nil, err
			}
			out = append(out, Orphan{Table: c.table, Column: c.column, Value: val, Referenced: c.ref, RowID: rowID})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func jsonbOrNil(b []byte) any {
	if b == nil {
		return nil
	}
	return b
}
