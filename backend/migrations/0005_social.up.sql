-- Social module tables (winzy.ai-rdc7.4): friendships, per-habit visibility
-- settings, default visibility preferences, and Witness Links — ported from
-- social-service's EF Core model (see SocialDbContextModelSnapshot.cs and its
-- two migrations, InitialCreate + AddWitnessLinks, folded into one file here
-- since the Go schema is created fresh rather than migrated forward step by
-- step the way the C# history was).
--
-- Enum columns (status, visibility, default_habit_visibility) store the C#
-- PascalCase name exactly as EF Core's HasConversion<string>() did, matching
-- the habits/promises convention (see 0003_habits.up.sql's identical note).
--
-- No FK to users(id), matching every other table in this schema: the old
-- system had none (separate databases), and this port preserves that exactly
-- rather than adding new referential-integrity surface the C# system never
-- had. habit_id columns (visibility_settings, witness_link_habits) likewise
-- carry no FK to habits(id) — SocialDbContext.cs never declared one either,
-- even though habits and social now share one database. Cascade cleanup on
-- account deletion runs at the application layer via the social module's
-- events.UserDeleted handler (see service.go); habit.created/habit.archived
-- keep visibility_settings in sync the same way.
CREATE TABLE friendships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL,
    friend_id uuid NOT NULL,
    status varchar(16) NOT NULL
);

CREATE INDEX ix_friendships_user_id ON friendships (user_id);
CREATE INDEX ix_friendships_friend_id ON friendships (friend_id);
CREATE UNIQUE INDEX ix_friendships_user_id_friend_id ON friendships (user_id, friend_id);

CREATE TABLE social_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL,
    default_habit_visibility varchar(16) NOT NULL
);

CREATE UNIQUE INDEX ix_social_preferences_user_id ON social_preferences (user_id);

CREATE TABLE visibility_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL,
    habit_id uuid NOT NULL,
    visibility varchar(16) NOT NULL
);

CREATE INDEX ix_visibility_settings_user_id ON visibility_settings (user_id);
CREATE UNIQUE INDEX ix_visibility_settings_user_id_habit_id ON visibility_settings (user_id, habit_id);

CREATE TABLE witness_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    owner_id uuid NOT NULL,
    token varchar(64) NOT NULL,
    label varchar(100),
    revoked_at timestamptz
);

CREATE INDEX ix_witness_links_owner_id ON witness_links (owner_id);
CREATE UNIQUE INDEX ix_witness_links_token ON witness_links (token);

-- witness_link_habits is the per-link habit allowlist; its only FK in the
-- whole social schema (cascades so revoking/deleting the parent link cannot
-- orphan allowlist rows), matching SocialDbContext.cs's WitnessLinkHabit
-- configuration exactly.
CREATE TABLE witness_link_habits (
    witness_link_id uuid NOT NULL REFERENCES witness_links (id) ON DELETE CASCADE,
    habit_id uuid NOT NULL,
    PRIMARY KEY (witness_link_id, habit_id)
);

CREATE INDEX ix_witness_link_habits_witness_link_id ON witness_link_habits (witness_link_id);
