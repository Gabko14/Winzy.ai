package verify

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"winzy.ai/migrate/internal/config"
	"winzy.ai/migrate/internal/load"
)

// Counts holds source vs target row counts for one table.
type Counts struct {
	Table    string
	Source   int
	Target   int
	Expected int // from archive source-row-counts.txt / bead
	Delta    int // target - source
}

// UserDistinct is distinct user_id (or equivalent) per module vs auth users.
type UserDistinct struct {
	Module string
	Column string
	Count  int
}

// Report is the structured verification payload.
type Report struct {
	Counts           []Counts
	RefreshTokensSrc int
	RefreshTokensTgt int
	Orphans          []load.Orphan
	UserDistincts    []UserDistinct
	AuthUsers        int
	OK               bool
	Failures         []string
}

// Run compares source DBs to winzy_rehearsal and builds a verification report.
func Run(ctx context.Context, cfg config.Config, loadRes *load.Result) (*Report, error) {
	rep := &Report{Orphans: nil}
	if loadRes != nil {
		rep.Orphans = loadRes.Orphans
	}

	sources := map[string]*pgxpool.Pool{}
	defer func() {
		for _, p := range sources {
			p.Close()
		}
	}()
	for _, svc := range config.SourceServices {
		p, err := pgxpool.New(ctx, cfg.SourceURL(svc.DB))
		if err != nil {
			return nil, fmt.Errorf("verify: source %s: %w", svc.DB, err)
		}
		sources[svc.Name] = p
	}
	target, err := pgxpool.New(ctx, cfg.TargetURL())
	if err != nil {
		return nil, fmt.Errorf("verify: target: %w", err)
	}
	defer target.Close()

	type spec struct {
		table  string
		source string // service name
	}
	specs := []spec{
		{"users", "auth"},
		{"habits", "habit"},
		{"completions", "habit"},
		{"promises", "habit"},
		{"friendships", "social"},
		{"social_preferences", "social"},
		{"visibility_settings", "social"},
		{"witness_links", "social"},
		{"witness_link_habits", "social"},
		{"challenges", "challenge"},
		{"notifications", "notification"},
		{"device_tokens", "notification"},
		{"notification_settings", "notification"},
		{"feed_entries", "activity"},
	}

	for _, s := range specs {
		srcN, err := count(ctx, sources[s.source], s.table)
		if err != nil {
			return nil, err
		}
		tgtN, err := count(ctx, target, s.table)
		if err != nil {
			return nil, err
		}
		exp := config.ExpectedCounts[s.table]
		c := Counts{Table: s.table, Source: srcN, Target: tgtN, Expected: exp, Delta: tgtN - srcN}
		rep.Counts = append(rep.Counts, c)
		if srcN != exp {
			rep.Failures = append(rep.Failures, fmt.Sprintf("%s: source count %d != archive expected %d", s.table, srcN, exp))
		}
		if tgtN != srcN {
			rep.Failures = append(rep.Failures, fmt.Sprintf("%s: target %d != source %d (delta %+d)", s.table, tgtN, srcN, tgtN-srcN))
		}
	}

	rtSrc, err := count(ctx, sources["auth"], "refresh_tokens")
	if err != nil {
		return nil, err
	}
	rtTgt, err := count(ctx, target, "refresh_tokens")
	if err != nil {
		return nil, err
	}
	rep.RefreshTokensSrc = rtSrc
	rep.RefreshTokensTgt = rtTgt
	if rtSrc != config.ExpectedCounts["refresh_tokens"] {
		rep.Failures = append(rep.Failures, fmt.Sprintf("refresh_tokens: source %d != expected %d", rtSrc, config.ExpectedCounts["refresh_tokens"]))
	}
	if rtTgt != 0 {
		rep.Failures = append(rep.Failures, fmt.Sprintf("refresh_tokens: target has %d rows (must be 0 — not migrated)", rtTgt))
	}

	authUsers, err := count(ctx, target, "users")
	if err != nil {
		return nil, err
	}
	rep.AuthUsers = authUsers

	distincts := []struct {
		module, column, sql string
	}{
		{"habits", "user_id", `SELECT COUNT(DISTINCT user_id) FROM habits`},
		{"completions", "user_id", `SELECT COUNT(DISTINCT user_id) FROM completions`},
		{"promises", "user_id", `SELECT COUNT(DISTINCT user_id) FROM promises`},
		{"friendships", "user_id+friend_id", `SELECT COUNT(DISTINCT uid) FROM (
			SELECT user_id AS uid FROM friendships UNION SELECT friend_id FROM friendships) t`},
		{"social_preferences", "user_id", `SELECT COUNT(DISTINCT user_id) FROM social_preferences`},
		{"visibility_settings", "user_id", `SELECT COUNT(DISTINCT user_id) FROM visibility_settings`},
		{"witness_links", "owner_id", `SELECT COUNT(DISTINCT owner_id) FROM witness_links`},
		{"challenges", "creator+recipient", `SELECT COUNT(DISTINCT uid) FROM (
			SELECT creator_id AS uid FROM challenges UNION SELECT recipient_id FROM challenges) t`},
		{"notifications", "user_id", `SELECT COUNT(DISTINCT user_id) FROM notifications`},
		{"feed_entries", "actor_id", `SELECT COUNT(DISTINCT actor_id) FROM feed_entries`},
	}
	for _, d := range distincts {
		var n int
		if err := target.QueryRow(ctx, d.sql).Scan(&n); err != nil {
			return nil, fmt.Errorf("verify: distinct %s: %w", d.module, err)
		}
		rep.UserDistincts = append(rep.UserDistincts, UserDistinct{Module: d.module, Column: d.column, Count: n})
		if n > authUsers {
			rep.Failures = append(rep.Failures, fmt.Sprintf("%s distinct users %d > auth users %d", d.module, n, authUsers))
		}
	}

	if len(rep.Orphans) > 0 {
		rep.Failures = append(rep.Failures, fmt.Sprintf("%d orphan reference(s) — see Orphans section", len(rep.Orphans)))
	}

	rep.OK = len(rep.Failures) == 0
	return rep, nil
}

func count(ctx context.Context, pool *pgxpool.Pool, table string) (int, error) {
	var n int
	q := fmt.Sprintf("SELECT COUNT(*) FROM %s", table)
	if err := pool.QueryRow(ctx, q).Scan(&n); err != nil {
		return 0, fmt.Errorf("verify: count %s: %w", table, err)
	}
	return n, nil
}
