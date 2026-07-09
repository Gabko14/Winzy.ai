-- Habits module tables (winzy.ai-rdc7.3.1): habits + completions, ported
-- from habit-service's EF Core model (see HabitDbContextModelSnapshot.cs).
-- Enum columns store the C# PascalCase name (e.g. 'Daily', 'Full') exactly
-- as EF Core's HasConversion<string>() did — the wire (JSON) representation
-- is a separate, lowercase concern handled entirely in Go (see models.go).
--
-- Promises (habit-service's third table) are NOT created here — Flame
-- Promises land with winzy.ai-rdc7.3.3, which also owns the DELETE
-- /habits/{id} -> cancel-active-promise integration point this bead leaves
-- marked but unimplemented.
--
-- habits.user_id and completions.user_id intentionally carry no foreign key
-- to users(id): the old schema had none (separate databases), and this port
-- preserves that exactly rather than adding new referential-integrity
-- surface the C# system never had. Cascade cleanup on account deletion is
-- handled at the application layer via the events.UserDeleted hook (see
-- service.go), matching the old system's NATS subscriber mechanism.
CREATE TABLE habits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL,
    name varchar(256) NOT NULL,
    icon varchar(64),
    color varchar(32),
    frequency varchar(16) NOT NULL,
    custom_days jsonb,
    minimum_description varchar(512),
    archived_at timestamptz
);

CREATE INDEX ix_habits_user_id ON habits (user_id);

CREATE TABLE completions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    habit_id uuid NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    completed_at timestamptz NOT NULL,
    local_date date NOT NULL,
    completion_kind varchar(16) NOT NULL DEFAULT 'Full',
    note varchar(512)
);

CREATE UNIQUE INDEX ix_completions_habit_id_local_date ON completions (habit_id, local_date);
CREATE INDEX ix_completions_user_id ON completions (user_id);
