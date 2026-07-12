-- Activity module tables (winzy.ai-rdc7.7): friends activity feed —
-- ported from activity-service's EF Core model (see ActivityDbContext.cs
-- and its migrations InitialCreate + AddIdempotencyKey + AddSoftDelete +
-- AddDeletedAtPartialIndex + AddActorNameColumns, folded into one file
-- here since the Go schema is created fresh).
--
-- PLANNED SIMPLIFICATION (documented on the bead): ActorUsername /
-- ActorDisplayName columns and ActorNameBackfillJob are intentionally
-- dropped. Names live in the shared users table and are joined at read
-- time via auth.BatchProfiles — fewer moving parts, names never stale.
--
-- Soft-delete: every application read filters deleted_at IS NULL (the C#
-- EF global query filter). Partial index ix_feed_entries_not_deleted
-- matches that filter. IdempotencyKey unique partial index prevents
-- duplicates on event redelivery (ON CONFLICT DO NOTHING).
--
-- No FK to users(id), matching every other table in this schema: the old
-- system had none (separate databases). Cascade cleanup on account
-- deletion runs at the application layer via the activity module's
-- events.UserDeleted handler.
CREATE TABLE feed_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    actor_id uuid NOT NULL,
    event_type varchar(64) NOT NULL,
    data jsonb,
    idempotency_key varchar(256),
    deleted_at timestamptz
);

CREATE INDEX ix_feed_entries_actor_id ON feed_entries (actor_id);
CREATE INDEX ix_feed_entries_created_at ON feed_entries (created_at);
CREATE INDEX ix_feed_entries_actor_id_created_at ON feed_entries (actor_id, created_at);

CREATE UNIQUE INDEX ix_feed_entries_idempotency_key
    ON feed_entries (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX ix_feed_entries_not_deleted
    ON feed_entries (deleted_at)
    WHERE deleted_at IS NULL;
