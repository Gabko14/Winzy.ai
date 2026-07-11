-- Flame Promises (winzy.ai-rdc7.3.3): a user's private commitment to keep a
-- habit's consistency at or above a target through an end date, ported from
-- habit-service's Promise entity (Entities/Promise.cs) and its two EF Core
-- migrations (AddFlamePromises, AddPromiseIsPublicOnFlame) — folded into one
-- file here since the Go schema is created fresh rather than migrated
-- forward step by step the way the C# history was.
--
-- status stores the C# PascalCase enum name (Active/Kept/EndedBelow/
-- Cancelled) verbatim, matching the habits/completions convention (see
-- 0003_habits.up.sql's frequency/completion_kind columns) rather than a
-- Postgres enum type or lowercase strings.
--
-- promises.habit_id cascades on habit delete — the one FK this table has.
-- No FK to users(id), matching every other table in this schema (see
-- 0003_habits.up.sql's identical note): cascade cleanup on account deletion
-- runs at the application layer via the habits module's existing
-- events.UserDeleted handler, which now also removes a user's promises
-- (see internal/habits/store.go's deleteUserData).
CREATE TABLE promises (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL,
    habit_id uuid NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
    target_consistency double precision NOT NULL,
    end_date date NOT NULL,
    private_note varchar(512),
    status varchar(16) NOT NULL,
    is_public_on_flame boolean NOT NULL DEFAULT false,
    resolved_at timestamptz
);

CREATE INDEX ix_promises_habit_id ON promises (habit_id);
CREATE INDEX ix_promises_user_id ON promises (user_id);

-- Partial unique index: at most one Active promise per (user, habit) at a
-- time, matching AddFlamePromises' filtered unique index exactly — a
-- resolved or cancelled promise never blocks a new one on the same habit.
CREATE UNIQUE INDEX ix_promises_user_id_habit_id ON promises (user_id, habit_id)
    WHERE status = 'Active';
